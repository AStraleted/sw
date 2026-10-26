/* =====================================================================
   API-МАРШРУТЫ
   ===================================================================== */
const fs = require("fs");
const crypto = require("crypto");
const CONFIG = require("./config");
const db = require("./db");
const auth = require("./auth");
const { HttpError, sendJson, readJsonBody, clientIp, createRouter, rateLimiter } = require("./http");
const { streamCompletion, buildApiMessages, buildSystemPrompt } = require("./claude");
const plans = require("./plans");
const auto = require("./auto");
const builtin = require("./builtin-skills");

const router = createRouter();
const loginLimit = rateLimiter(10, 60 * 1000);        // 10 попыток входа в минуту с IP
const registerLimit = rateLimiter(5, 60 * 60 * 1000); // 5 регистраций в час с IP
const sendLimit = rateLimiter(20, 60 * 1000);         // 20 сообщений в минуту на пользователя
const uploadLimit = rateLimiter(40, 10 * 60 * 1000);  // 40 файлов за 10 минут
const skillLimit = rateLimiter(20, 10 * 60 * 1000);   // 20 установок скиллов за 10 минут
const activeStreams = new Map();                       // userId → сколько ответов идёт сейчас
const MAX_PARALLEL_STREAMS = 2;

const uid = () => crypto.randomUUID();
const round2 = n => Math.round(n * 100) / 100;
const DEFAULT_TITLE = "Новый чат";

// ---------- справочники для клиента ----------
// Отдаём только те модели, что открыты на тарифе, плюс отметку о закрытых
function publicModels(user) {
  return CONFIG.MODELS.map(({ id, name, family, mult, note }) => ({
    id, name, family, mult, note, locked: user ? !plans.modelAllowed(user, { family }) : false,
  }));
}
const publicEfforts = () => Object.entries(CONFIG.EFFORTS).map(([id, e]) => ({ id, label: e.label, hint: e.hint }));
const publicConfig = user => ({
  mock: CONFIG.MOCK,
  allowRegistration: CONFIG.ALLOW_REGISTRATION,
  maxFileMb: user ? plans.features(user).maxFileMb : 10,
  defaultModel: CONFIG.DEFAULT_MODEL,
  telegram: CONFIG.CONTACT_TELEGRAM,
  tokensPerCredit: CONFIG.TOKENS_PER_CREDIT,
  yearDiscount: CONFIG.YEAR_DISCOUNT,
});

const validModel = id => id === "auto" || CONFIG.MODELS.some(m => m.id === id);
const validEffort = id => id === "auto" || id in CONFIG.EFFORTS;

function chatSummary(c) {
  return { id: c.id, title: c.title, pinned: !!c.pinned, model: c.model, effort: c.effort, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.messages.length };
}

function findChat(user, id) {
  const chat = db.getChats(user.id).find(c => c.id === id);
  if (!chat) throw new HttpError(404, "Чат не найден");
  return chat;
}

function titleFrom(text, files) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return files?.[0]?.name ? `Файл ${files[0].name}` : DEFAULT_TITLE;
  if (clean.length <= 48) return clean[0].toUpperCase() + clean.slice(1);
  const cut = clean.slice(0, 48);
  const sp = cut.lastIndexOf(" ");
  return (sp > 24 ? cut.slice(0, sp) : cut).replace(/[,.;:!?-]+$/, "") + "…";
}

// ======================= публичное =======================
router.add("GET", "/api/config", () => ({ config: publicConfig(null), plans: plans.publicPlans() }));

router.add("POST", "/api/auth/register", async (req, res) => {
  if (!CONFIG.ALLOW_REGISTRATION) throw new HttpError(403, "Регистрация закрыта администратором");
  if (!registerLimit(clientIp(req))) throw new HttpError(429, "Слишком много регистраций. Попробуйте позже");
  const { login, password, name } = await readJsonBody(req);
  const user = auth.createUser(login, password, name);
  auth.createSession(res, user, req);
  return { user: auth.publicUser(user) };
});

router.add("POST", "/api/auth/login", async (req, res) => {
  if (!loginLimit(clientIp(req))) throw new HttpError(429, "Слишком много попыток. Подождите минуту");
  const { login, password } = await readJsonBody(req);
  const user = auth.findByLogin(login);
  if (!user || typeof password !== "string" || !auth.verifyPassword(password, user)) throw new HttpError(401, "Неверный логин или пароль");
  if (user.disabled) throw new HttpError(403, "Аккаунт заблокирован администратором");
  auth.createSession(res, user, req);
  return { user: auth.publicUser(user) };
});

router.add("POST", "/api/auth/logout", (req, res) => {
  auth.destroySession(req, res);
  return { ok: true };
});

// ======================= профиль =======================
router.add("GET", "/api/me", req => {
  const user = auth.requireUser(req);
  return {
    user: auth.publicUser(user),
    models: publicModels(user),
    efforts: publicEfforts(),
    config: publicConfig(user),
    plans: plans.publicPlans(),
  };
});

// Тарифы и состояние подписки
router.add("GET", "/api/plans", req => {
  const user = auth.currentUser(req);
  return { plans: plans.publicPlans(), current: user ? plans.planInfo(user) : null, telegram: CONFIG.CONTACT_TELEGRAM, yearDiscount: CONFIG.YEAR_DISCOUNT };
});

router.add("PATCH", "/api/me", async req => {
  const user = auth.requireUser(req);
  const body = await readJsonBody(req);
  if (typeof body.name === "string" && body.name.trim()) user.name = body.name.trim().slice(0, 40);
  const s = body.settings || {};
  if (typeof s.systemPrompt === "string") user.settings.systemPrompt = s.systemPrompt.slice(0, 8000);
  if (validModel(s.defaultModel)) user.settings.defaultModel = s.defaultModel;
  if (validEffort(s.defaultEffort)) user.settings.defaultEffort = s.defaultEffort;
  if (typeof s.sendOnEnter === "boolean") user.settings.sendOnEnter = s.sendOnEnter;
  db.save();
  return { user: auth.publicUser(user) };
});

router.add("POST", "/api/me/password", async req => {
  const user = auth.requireUser(req);
  const { current, next } = await readJsonBody(req);
  if (!auth.verifyPassword(String(current || ""), user)) throw new HttpError(400, "Текущий пароль указан неверно");
  auth.validateCredentials(user.login, next);
  const { salt, hash } = auth.hashPassword(next);
  user.salt = salt; user.passHash = hash;
  db.save();
  return { ok: true };
});

// ======================= чаты =======================
router.add("GET", "/api/chats", req => {
  const user = auth.requireUser(req);
  const chats = db.getChats(user.id).map(chatSummary).sort((a, b) => b.updatedAt - a.updatedAt);
  return { chats };
});

router.add("POST", "/api/chats", async req => {
  const user = auth.requireUser(req);
  const body = await readJsonBody(req);
  const now = Date.now();
  const chat = {
    id: uid(), title: DEFAULT_TITLE, pinned: false,
    model: validModel(body.model) ? body.model : user.settings.defaultModel,
    effort: validEffort(body.effort) ? body.effort : user.settings.defaultEffort,
    createdAt: now, updatedAt: now, messages: [],
  };
  db.getChats(user.id).unshift(chat);
  db.saveChats(user.id);
  return { chat };
});

router.add("GET", "/api/chats/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  return { chat: findChat(user, p.id) };
});

router.add("PATCH", "/api/chats/:id", async (req, res, p) => {
  const user = auth.requireUser(req);
  const chat = findChat(user, p.id);
  const body = await readJsonBody(req);
  if (typeof body.title === "string" && body.title.trim()) chat.title = body.title.trim().slice(0, 120);
  if (typeof body.pinned === "boolean") chat.pinned = body.pinned;
  if (validModel(body.model)) chat.model = body.model;
  if (validEffort(body.effort)) chat.effort = body.effort;
  db.saveChats(user.id);
  return { chat: chatSummary(chat) };
});

router.add("DELETE", "/api/chats/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const chats = db.getChats(user.id);
  const i = chats.findIndex(c => c.id === p.id);
  if (i === -1) throw new HttpError(404, "Чат не найден");
  const [chat] = chats.splice(i, 1);
  // Удаляем файлы этого чата
  for (const m of chat.messages) for (const a of m.attachments || []) removeFile(a.id);
  db.saveChats(user.id);
  db.save();
  return { ok: true };
});

// Поиск по названиям и тексту сообщений
router.add("GET", "/api/search", req => {
  const user = auth.requireUser(req);
  const q = (new URL(req.url, "http://x").searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return { results: [] };
  const results = [];
  for (const c of db.getChats(user.id)) {
    let snippet = "";
    const inTitle = c.title.toLowerCase().includes(q);
    for (const m of c.messages) {
      const i = (m.content || "").toLowerCase().indexOf(q);
      if (i > -1) {
        const start = Math.max(0, i - 40);
        snippet = (start ? "…" : "") + m.content.slice(start, i + q.length + 60).replace(/\s+/g, " ");
        break;
      }
    }
    if (inTitle || snippet) results.push({ ...chatSummary(c), snippet });
  }
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return { results: results.slice(0, 30) };
});

// ======================= отправка сообщения (SSE) =======================
router.add("POST", "/api/chats/:id/messages", async (req, res, p) => {
  const user = auth.requireUser(req);
  const chat = findChat(user, p.id);
  if (!sendLimit(user.id)) throw new HttpError(429, "Слишком много сообщений подряд. Подождите минуту");
  if ((activeStreams.get(user.id) || 0) >= MAX_PARALLEL_STREAMS) throw new HttpError(429, "Уже идут два ответа. Дождитесь их окончания");
  plans.checkQuota(user);
  if (chat.busy) throw new HttpError(409, "В этом чате уже идёт ответ");

  const body = await readJsonBody(req);
  const mode = body.mode || "new"; // new | regenerate | edit
  if (validModel(body.model)) chat.model = body.model;
  if (validEffort(body.effort)) chat.effort = body.effort;

  let userMsg;
  if (mode === "regenerate") {
    // Убираем всё после последнего сообщения пользователя
    let i = chat.messages.length - 1;
    while (i >= 0 && chat.messages[i].role !== "user") i--;
    if (i < 0) throw new HttpError(400, "Нечего генерировать заново");
    chat.messages.splice(i + 1);
    userMsg = chat.messages[i];
  } else {
    const text = String(body.text || "").slice(0, 200000);
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .map(id => db.data.files[id])
      .filter(f => f && f.userId === user.id)
      .map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size }));
    if (mode === "edit") {
      const i = chat.messages.findIndex(m => m.id === body.messageId && m.role === "user");
      if (i === -1) throw new HttpError(404, "Сообщение не найдено");
      const old = chat.messages[i];
      chat.messages.splice(i);
      userMsg = { ...old, content: text, editedAt: Date.now() };
    } else {
      if (!text.trim() && !attachments.length) throw new HttpError(400, "Пустое сообщение");
      userMsg = { id: uid(), role: "user", content: text, attachments, createdAt: Date.now() };
    }
    chat.messages.push(userMsg);
    if (chat.title === DEFAULT_TITLE) chat.title = titleFrom(text, attachments);
  }

  // ---- выбор модели ----
  // «Авто» решается здесь, на сервере: браузер не может подставить дорогую модель в обход тарифа
  const feat = plans.features(user);
  const hasSkills = feat.skills && (db.data.skills[user.id] || []).some(s => s.enabled);
  let model, effort = chat.effort, autoPick = null;

  if (chat.model === "auto") {
    autoPick = auto.pick(user, {
      text: userMsg.content,
      attachments: userMsg.attachments || [],
      historyLength: chat.messages.length,
      hasSkills,
    });
    model = CONFIG.MODELS.find(m => m.id === autoPick.model);
    if (chat.effort === "auto" || !chat.effort) effort = autoPick.effort;
  } else {
    model = CONFIG.MODELS.find(m => m.id === chat.model);
    if (!model) throw new HttpError(400, "Неизвестная модель");
    plans.requireModel(user, model); // тариф проверяется на сервере
  }
  if (!CONFIG.EFFORTS[effort]) effort = "medium";

  const assistant = {
    id: uid(), role: "assistant", content: "", reasoning: "",
    model: model.id, effort, createdAt: Date.now(),
    auto: autoPick ? { reason: autoPick.reason, level: autoPick.level } : null,
  };
  chat.messages.push(assistant);
  chat.updatedAt = Date.now();
  chat.busy = true;
  activeStreams.set(user.id, (activeStreams.get(user.id) || 0) + 1);
  db.saveChats(user.id);

  // --- SSE ---
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emit = obj => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  emit({ type: "start", chat: chatSummary(chat), userMessage: userMsg, assistantMessage: assistant });

  const controller = new AbortController();
  res.on("close", () => { if (!res.writableFinished) controller.abort(); });
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);

  const messages = buildApiMessages(chat.messages.slice(0, -1), feat.historyLimit);
  const system = buildSystemPrompt(user);
  let usage = null, thinkingStart = 0;
  const started = Date.now();
  // Больше, чем осталось кредитов, модель потратить не должна
  const maxOutput = Math.max(512, Math.floor((user.credits * CONFIG.TOKENS_PER_CREDIT) / (model.mult * CONFIG.OUTPUT_WEIGHT)));

  try {
    for await (const evt of streamCompletion({ modelId: model.id, effort, system, messages, maxOutput, signal: controller.signal })) {
      if (evt.type === "thinking_start") { thinkingStart = thinkingStart || Date.now(); emit({ type: "thinking_start" }); }
      else if (evt.type === "thinking") { assistant.reasoning += evt.text; emit({ type: "thinking", text: evt.text }); }
      else if (evt.type === "text") {
        if (thinkingStart && !assistant.thinkingMs) assistant.thinkingMs = Date.now() - thinkingStart;
        assistant.content += evt.text;
        emit({ type: "text", text: evt.text });
      }
      else if (evt.type === "usage") usage = evt;
      else if (evt.type === "stop" && evt.reason === "max_tokens") assistant.truncated = true;
    }
  } catch (err) {
    if (err.name === "AbortError" || controller.signal.aborted) assistant.stopped = true;
    else {
      assistant.error = err.cause?.code === "ECONNREFUSED" || err.message === "fetch failed"
        ? "Сервер не смог связаться с API. Проверьте UPSTREAM_URL и интернет"
        : err.message;
      emit({ type: "error", message: assistant.error });
    }
  } finally {
    clearInterval(ping);
    if (thinkingStart && !assistant.thinkingMs) assistant.thinkingMs = Date.now() - thinkingStart;
    assistant.durationMs = Date.now() - started;

    // Если API не прислал расход (остановили раньше) — оцениваем по длине
    const input = usage?.input ?? Math.round(JSON.stringify(messages).length / 4);
    const output = usage?.output ?? Math.round((assistant.content.length + assistant.reasoning.length) / 4);
    const hadOutput = assistant.content || assistant.reasoning;
    const cost = assistant.error && !hadOutput ? 0 : plans.costOf(model, input, output);

    assistant.usage = { input, output };
    assistant.cost = cost;
    user.credits = round2(Math.max(0, user.credits - cost));
    if (cost > 0) {
      const log = db.data.usage[user.id] || (db.data.usage[user.id] = []);
      log.unshift({ at: Date.now(), chatId: chat.id, chatTitle: chat.title, model: model.id, effort, auto: !!autoPick, input, output, cost });
      log.splice(500);
    }
    activeStreams.set(user.id, Math.max(0, (activeStreams.get(user.id) || 1) - 1));
    delete chat.busy;
    chat.updatedAt = Date.now();
    db.saveChats(user.id);
    db.save();
    emit({ type: "done", message: assistant, credits: user.credits, plan: plans.planInfo(user), chat: chatSummary(chat) });
    res.end();
  }
});

// ======================= файлы =======================
router.add("POST", "/api/uploads", async req => {
  const user = auth.requireUser(req);
  plans.requireFeature(user, "files");
  if (!uploadLimit(user.id)) throw new HttpError(429, "Слишком много файлов подряд. Подождите немного");
  const name = decodeURIComponent(String(req.headers["x-file-name"] || "file")).replace(/[\\/\0]/g, "_").slice(0, 200);
  const type = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim().slice(0, 100);
  // Предел зависит от тарифа и проверяется на сервере
  const maxMb = Math.min(plans.features(user).maxFileMb, CONFIG.MAX_FILE_MB);
  const limit = maxMb * 1048576;
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, `На вашем тарифе предел файла — ${maxMb} МБ`);

  const id = uid();
  const file = db.uploadPath(id);
  const out = fs.createWriteStream(file);
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, `На вашем тарифе предел файла — ${maxMb} МБ`);
      if (!out.write(chunk)) await new Promise(r => out.once("drain", r));
    }
    await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
  } catch (e) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw e;
  }
  db.data.files[id] = { id, userId: user.id, name, type, size, createdAt: Date.now() };
  db.save();
  return { file: { id, name, type, size } };
});

const INLINE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

router.add("GET", "/api/uploads/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const meta = db.data.files[p.id];
  if (!meta || meta.userId !== user.id) throw new HttpError(404, "Файл не найден");
  const inline = INLINE_TYPES.includes(meta.type);
  res.writeHead(200, {
    // HTML и SVG отдаём только на скачивание, чтобы они не выполнялись на нашем сайте
    "Content-Type": inline ? meta.type : "application/octet-stream",
    "Content-Length": meta.size,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=86400",
  });
  fs.createReadStream(db.uploadPath(p.id)).pipe(res);
  return undefined;
});

router.add("DELETE", "/api/uploads/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const meta = db.data.files[p.id];
  if (!meta || meta.userId !== user.id) throw new HttpError(404, "Файл не найден");
  // Удаляем, только если файл ещё не в сообщении
  const used = db.getChats(user.id).some(c => c.messages.some(m => m.attachments?.some(a => a.id === p.id)));
  if (!used) { removeFile(p.id); db.save(); }
  return { ok: true };
});

function removeFile(id) {
  delete db.data.files[id];
  fs.rmSync(db.uploadPath(id), { force: true });
}

// ======================= скиллы =======================
const userSkills = user => db.data.skills[user.id] || (db.data.skills[user.id] = []);
const skillOut = s => ({ id: s.id, name: s.name, description: s.description, url: s.url, path: s.path, enabled: s.enabled, builtin: s.builtin || null, chars: s.content.length, createdAt: s.createdAt });

function skillMeta(content, path, repo) {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const field = k => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "");
  const parts = (path || "").split("/");
  return {
    name: field("name") || (parts.length > 1 ? parts[parts.length - 2] : repo) || "Скилл",
    description: (field("description") || "").slice(0, 300),
  };
}

async function fetchRepoSkills(url) {
  const m = String(url).match(/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s]+)\/?([^\s#?]*))?/);
  if (!m) throw new HttpError(400, "Нужна ссылка вида https://github.com/владелец/репозиторий");
  const [, owner, rawRepo, branch = "HEAD", subdir = ""] = m;
  const repo = rawRepo.replace(/\.git$/, "");
  const headers = { "User-Agent": "squled-studio", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN && !process.env.GITHUB_TOKEN.includes("proxy")) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const get = async (url, h = headers) => {
    try { return await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw new HttpError(502, e.name === "TimeoutError" ? "GitHub не ответил вовремя" : "Сервер не смог связаться с GitHub. Проверьте интернет на сервере"); }
  };
  const treeRes = await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (treeRes.status === 404) throw new HttpError(404, "Репозиторий не найден или он приватный");
  if (!treeRes.ok) throw new HttpError(502, `GitHub не отдал файлы репозитория (${treeRes.status})`);
  let files = ((await treeRes.json()).tree || []).filter(f => f.type === "blob").map(f => f.path);
  if (subdir) files = files.filter(f => f.startsWith(subdir.replace(/\/$/, "") + "/"));

  let paths = files.filter(f => /(^|\/)SKILL\.md$/i.test(f));
  if (!paths.length) paths = files.filter(f => /^README\.md$/i.test(f.slice(subdir ? subdir.replace(/\/$/, "").length + 1 : 0)));
  if (!paths.length) throw new HttpError(404, "В репозитории нет SKILL.md");
  paths = paths.slice(0, 40);

  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
  const found = await Promise.all(paths.map(async path => {
    const r = await get(base + path.split("/").map(encodeURIComponent).join("/"), { "User-Agent": "squled-studio" });
    if (!r.ok) return null;
    const content = (await r.text()).slice(0, CONFIG.MAX_SKILL_CHARS);
    return { url: `https://github.com/${owner}/${repo}`, path, content, ...skillMeta(content, path, repo) };
  }));
  return found.filter(Boolean);
}

router.add("GET", "/api/skills", req => {
  const user = auth.requireUser(req);
  return {
    skills: userSkills(user).map(skillOut),
    catalog: builtin.catalog(),
    available: plans.features(user).skills,
  };
});

// Встроенный скилл из каталога — в один клик
router.add("POST", "/api/skills/builtin", async req => {
  const user = auth.requireUser(req);
  plans.requireFeature(user, "skills");
  const { key } = await readJsonBody(req);
  const src = builtin.BY_KEY[key];
  if (!src) throw new HttpError(404, "Такого скилла нет");
  const list = userSkills(user);
  if (list.some(s => s.builtin === key)) throw new HttpError(409, "Этот скилл уже подключён");
  list.push({
    id: uid(), enabled: true, createdAt: Date.now(), builtin: key,
    name: src.name, description: src.description, content: src.content, url: "", path: "",
  });
  db.save();
  return { skills: list.map(skillOut) };
});

router.add("POST", "/api/skills", async req => {
  const user = auth.requireUser(req);
  plans.requireFeature(user, "skills");
  if (!skillLimit(user.id)) throw new HttpError(429, "Слишком много установок подряд. Подождите немного");
  const body = await readJsonBody(req);
  const list = userSkills(user);
  if (list.length >= 40) throw new HttpError(400, "Слишком много скиллов: удалите лишние");
  let incoming;
  if (body.url) incoming = await fetchRepoSkills(body.url);
  else {
    const content = String(body.content || "").trim().slice(0, CONFIG.MAX_SKILL_CHARS);
    if (!content) throw new HttpError(400, "Добавьте ссылку на GitHub или текст скилла");
    incoming = [{ url: "", path: "", content, ...skillMeta(content, "", ""), name: String(body.name || "").trim().slice(0, 60) || skillMeta(content).name }];
  }
  const fresh = incoming.filter(s => !s.url || !list.some(x => x.url === s.url && x.path === s.path));
  for (const s of fresh) list.push({ id: uid(), enabled: true, createdAt: Date.now(), ...s });
  db.save();
  return { added: fresh.length, skills: list.map(skillOut) };
});

router.add("PATCH", "/api/skills/:id", async (req, res, p) => {
  const user = auth.requireUser(req);
  plans.requireFeature(user, "skills");
  const s = userSkills(user).find(x => x.id === p.id);
  if (!s) throw new HttpError(404, "Скилл не найден");
  const body = await readJsonBody(req);
  if (typeof body.enabled === "boolean") s.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) s.name = body.name.trim().slice(0, 60);
  db.save();
  return { skill: skillOut(s) };
});

router.add("GET", "/api/skills/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const s = userSkills(user).find(x => x.id === p.id);
  if (!s) throw new HttpError(404, "Скилл не найден");
  return { skill: { ...skillOut(s), content: s.content } };
});

router.add("DELETE", "/api/skills/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const list = userSkills(user);
  const i = list.findIndex(x => x.id === p.id);
  if (i > -1) list.splice(i, 1);
  db.save();
  return { ok: true };
});

// ======================= предпросмотр =======================
// Страница собирается на сервере и отдаётся по одноразовой ссылке.
// Поэтому без подходящего тарифа предпросмотр не открыть даже из консоли браузера.
const previews = new Map(); // id → { userId, html, until }
const PREVIEW_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of previews) if (p.until < now) previews.delete(id);
}, 60000).unref();

router.add("POST", "/api/preview", async req => {
  const user = auth.requireUser(req);
  plans.requireFeature(user, "preview");
  const { code, lang } = await readJsonBody(req, 3 * 1024 * 1024);
  const src = String(code || "");
  if (!src.trim()) throw new HttpError(400, "Нечего показывать");

  const isSvg = /^svg$/i.test(lang || "") || /^\s*<svg[\s>]/i.test(src);
  const html = isSvg
    ? `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:92vw;max-height:92vh}</style>${src}`
    : /<html[\s>]/i.test(src) ? src
    : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${src}</body></html>`;

  const id = uid();
  previews.set(id, { userId: user.id, html, until: Date.now() + PREVIEW_TTL });
  if (previews.size > 500) previews.delete(previews.keys().next().value);
  return { id };
});

router.add("GET", "/api/preview/:id", (req, res, p) => {
  const user = auth.requireUser(req);
  const entry = previews.get(p.id);
  if (!entry || entry.userId !== user.id || entry.until < Date.now()) throw new HttpError(404, "Предпросмотр устарел");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // Песочница: страница не получает доступ ни к cookie сайта, ни к его API
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(entry.html);
  return undefined;
});

// ======================= расход =======================
router.add("GET", "/api/usage", req => {
  const user = auth.requireUser(req);
  const log = db.data.usage[user.id] || [];
  const dayAgo = Date.now() - 86400000, monthAgo = Date.now() - 30 * 86400000;
  const sum = (arr, k) => round2(arr.reduce((s, e) => s + e[k], 0));
  return {
    credits: round2(user.credits),
    today: sum(log.filter(e => e.at > dayAgo), "cost"),
    month: sum(log.filter(e => e.at > monthAgo), "cost"),
    tokens: { input: sum(log, "input"), output: sum(log, "output") },
    entries: log.slice(0, 100),
  };
});

// ======================= администратор =======================
// Журнал действий: кто, что и кому изменил
function audit(admin, action, target, details = {}) {
  const log = db.data.audit || (db.data.audit = []);
  log.unshift({ at: Date.now(), admin: admin.login, action, target: target?.login || null, ...details });
  log.splice(1000);
}

router.add("GET", "/api/admin/users", req => {
  auth.requireAdmin(req);
  const users = Object.values(db.data.users).map(u => {
    const log = db.data.usage[u.id] || [];
    return {
      ...auth.publicUser(u),
      chats: db.getChats(u.id).length,
      spent: round2(log.reduce((s, e) => s + e.cost, 0)),
      tokens: log.reduce((s, e) => s + e.input + e.output, 0),
      lastActive: log[0]?.at || null,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  return { users, plans: plans.publicPlans(), audit: (db.data.audit || []).slice(0, 50) };
});

router.add("PATCH", "/api/admin/users/:id", async (req, res, p) => {
  const admin = auth.requireAdmin(req);
  const u = db.data.users[p.id];
  if (!u) throw new HttpError(404, "Пользователь не найден");
  const body = await readJsonBody(req);

  // выдача тарифа
  if (body.plan) {
    const period = body.period === "year" ? "year" : "month";
    const sub = plans.grantPlan(u, body.plan, period, body.withCredits !== false);
    audit(admin, "plan", u, { plan: body.plan, period, until: sub.until });
  }
  if (typeof body.addCredits === "number" && isFinite(body.addCredits)) {
    u.credits = round2(Math.max(0, u.credits + body.addCredits));
    audit(admin, "credits", u, { add: body.addCredits, result: u.credits });
  }
  if (typeof body.credits === "number" && isFinite(body.credits)) {
    u.credits = round2(Math.max(0, Math.min(body.credits, 1000000)));
    audit(admin, "credits", u, { set: u.credits });
  }
  if (u.id !== admin.id) {
    if (body.role === "admin" || body.role === "user") { u.role = body.role; audit(admin, "role", u, { role: body.role }); }
    if (typeof body.disabled === "boolean") {
      u.disabled = body.disabled;
      audit(admin, u.disabled ? "disable" : "enable", u);
      if (u.disabled) for (const [t, s] of Object.entries(db.data.sessions)) if (s.userId === u.id) delete db.data.sessions[t];
    }
    if (typeof body.resetPassword === "string" && body.resetPassword) {
      auth.validateCredentials(u.login, body.resetPassword);
      const { salt, hash } = auth.hashPassword(body.resetPassword);
      u.salt = salt; u.passHash = hash;
      for (const [t, s] of Object.entries(db.data.sessions)) if (s.userId === u.id) delete db.data.sessions[t];
      audit(admin, "password", u);
    }
  }
  db.save();
  return { user: auth.publicUser(u) };
});

// Создание пользователя администратором (когда регистрация закрыта)
router.add("POST", "/api/admin/users", async req => {
  const admin = auth.requireAdmin(req);
  const { login, password, name, plan, period } = await readJsonBody(req);
  const u = auth.createUser(login, password, name);
  if (plan && plan !== "free") plans.grantPlan(u, plan, period === "year" ? "year" : "month");
  audit(admin, "create", u, { plan: plan || "free" });
  db.save();
  return { user: auth.publicUser(u) };
});

router.add("DELETE", "/api/admin/users/:id", (req, res, p) => {
  const admin = auth.requireAdmin(req);
  const u = db.data.users[p.id];
  if (!u) throw new HttpError(404, "Пользователь не найден");
  if (u.id === admin.id) throw new HttpError(400, "Нельзя удалить самого себя");
  for (const [t, s] of Object.entries(db.data.sessions)) if (s.userId === u.id) delete db.data.sessions[t];
  for (const c of db.getChats(u.id)) for (const m of c.messages) for (const a of m.attachments || []) removeFile(a.id);
  db.dropUser(u.id);
  delete db.data.users[u.id];
  delete db.data.skills[u.id];
  delete db.data.usage[u.id];
  audit(admin, "delete", u);
  db.save();
  return { ok: true };
});

// ======================= обработчик =======================
async function handleApi(req, res, pathname) {
  try {
    // Защита от CSRF: изменяющие запросы должны идти с нашего фронтенда
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "squled") throw new HttpError(403, "Запрос отклонён");
    const found = router.match(req.method, pathname);
    if (!found) throw new HttpError(404, "Метод API не найден");
    const result = await found.handler(req, res, found.params);
    if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Внутренняя ошибка сервера" : err.message });
    else if (!res.writableEnded) res.end();
  }
}

module.exports = { handleApi };
