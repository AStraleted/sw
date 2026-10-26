/* =====================================================================
   ЗАПРОСЫ К МОДЕЛИ
   - собирает историю и вложения в формат Messages API
   - стримит ответ и разбирает события SSE
   - сам подбирает рабочий режим рассуждений (adaptive → budget → без них)
   - демо-режим без ключа, если API_TOKEN не задан
   ===================================================================== */
const fs = require("fs");
const CONFIG = require("./config");
const db = require("./db");

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
// Сколько всего вложений уходит в один запрос. Больше — и сервис отклонит запрос целиком.
const ATTACH_BUDGET = 12 * 1048576;  // суммарно по всем сообщениям
const MAX_IMAGE_BYTES = 4 * 1048576; // одно изображение
const MAX_PDF_BYTES = 12 * 1048576;  // один PDF
const TEXT_EXT = /\.(txt|md|markdown|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|json|jsonl|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sql|sh|bash|zsh|ps1|bat|ya?ml|toml|ini|cfg|conf|env|xml|svg|csv|tsv|log|vue|svelte|lua|r|dart|scala|tex|rst|gitignore|dockerfile)$/i;

const isTextFile = f => (f.type || "").startsWith("text/") || /json|xml|javascript|yaml|csv/.test(f.type || "") || TEXT_EXT.test(f.name);

// ---------- вложения → блоки контента ----------
// budget — сколько байт вложений ещё можно отправить; расходуется по ходу сборки
function fileBlocks(fileId, budget) {
  const meta = db.data.files[fileId];
  if (!meta) return [];
  const p = db.uploadPath(fileId);
  if (!fs.existsSync(p)) return [{ type: "text", text: `[Файл ${meta.name} недоступен]` }];
  const mb = meta.size / 1048576;

  if (IMAGE_TYPES.includes(meta.type)) {
    if (meta.size > MAX_IMAGE_BYTES) return [{ type: "text", text: `[Изображение ${meta.name} слишком большое (${mb.toFixed(1)} МБ) и не передано модели]` }];
    if (budget.left < meta.size) return [{ type: "text", text: `[Изображение ${meta.name} не передано: в одном запросе уже слишком много вложений]` }];
    budget.left -= meta.size;
    return [{ type: "image", source: { type: "base64", media_type: meta.type, data: fs.readFileSync(p).toString("base64") } }];
  }
  if (meta.type === "application/pdf") {
    if (meta.size > MAX_PDF_BYTES) return [{ type: "text", text: `[PDF ${meta.name} больше ${MAX_PDF_BYTES / 1048576} МБ и не передан модели]` }];
    if (budget.left < meta.size) return [{ type: "text", text: `[PDF ${meta.name} не передан: в одном запросе уже слишком много вложений]` }];
    budget.left -= meta.size;
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(p).toString("base64") }, title: meta.name }];
  }
  if (isTextFile(meta)) {
    let text = fs.readFileSync(p, "utf8");
    let cut = "";
    if (text.length > CONFIG.MAX_TEXT_FILE_CHARS) { text = text.slice(0, CONFIG.MAX_TEXT_FILE_CHARS); cut = "\n[…файл обрезан]"; }
    return [{ type: "text", text: `<file name="${meta.name}">\n${text}${cut}\n</file>` }];
  }
  return [{ type: "text", text: `[Прикреплён файл ${meta.name} (${meta.type || "неизвестный тип"}, ${mb.toFixed(2)} МБ). Его содержимое нельзя передать модели в этом формате.]` }];
}

// История чата → messages для API. Глубина зависит от тарифа.
function buildApiMessages(history, limit = CONFIG.MAX_HISTORY) {
  let msgs = history.filter(m => !m.error || m.content).slice(-Math.min(limit, CONFIG.MAX_HISTORY));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  // Бюджет тратим с конца: свежие вложения важнее старых
  const budget = { left: ATTACH_BUDGET };
  const blocksByIndex = new Map();
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user" || !m.attachments?.length) continue;
    const blocks = [];
    for (const a of m.attachments) blocks.push(...fileBlocks(a.id, budget));
    blocksByIndex.set(i, blocks);
  }

  const out = [];
  msgs.forEach((m, i) => {
    let content;
    if (m.role === "user") {
      content = [...(blocksByIndex.get(i) || [])];
      if (m.content) content.push({ type: "text", text: m.content });
      if (!content.length) content.push({ type: "text", text: "…" });
    } else {
      content = [{ type: "text", text: m.content || (m.stopped ? "[ответ прерван]" : "…") }];
    }
    // Две реплики одной роли подряд склеиваем — API этого требует
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...content);
    else out.push({ role: m.role, content });
  });
  return out;
}

function buildSystemPrompt(user) {
  const plans = require("./plans");
  const parts = [CONFIG.BASE_SYSTEM_PROMPT];
  const now = new Date();
  parts.push(`Сегодня ${now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}. Пользователя зовут ${user.name}.`);
  if (user.settings?.systemPrompt?.trim()) parts.push("Инструкции пользователя:\n" + user.settings.systemPrompt.trim());

  // Скиллы подмешиваются только на тарифах, где они открыты
  if (plans.features(user).skills) {
    const skills = (db.data.skills[user.id] || []).filter(s => s.enabled);
    if (skills.length) {
      parts.push("Ниже — подключённые скиллы: инструкции для отдельных видов задач. Следуй тому скиллу, который подходит под запрос; если ни один не подходит, работай как обычно.");
      for (const s of skills) parts.push(`<skill name="${s.name}">\n${s.content}\n</skill>`);
    }
  }
  return parts.join("\n\n");
}

// ---------- режимы рассуждений ----------
const MODE_CHAIN = ["adaptive", "adaptive-plain", "budget", "none"];
const workingMode = new Map(); // модель → режим, который API принял

function applyThinking(body, mode, effort, maxOutput) {
  const e = CONFIG.EFFORTS[effort] || CONFIG.EFFORTS.medium;
  body.max_tokens = maxOutput ? Math.max(512, Math.min(e.maxTokens, maxOutput)) : e.maxTokens;
  if (mode === "adaptive") {
    body.thinking = { type: "adaptive", display: "summarized" };
    body.output_config = { effort: e.effort };
  } else if (mode === "adaptive-plain") {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: e.effort };
  } else if (mode === "budget") {
    const budget = Math.min(e.budget, Math.max(1024, Math.floor(body.max_tokens * 0.6)));
    body.thinking = { type: "enabled", budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens, budget + 2048);
  }
}

function modesFor(model) {
  const known = workingMode.get(model.id);
  if (known) return [known];
  const start = model.thinking === "none" ? "none" : model.thinking === "budget" ? "budget" : "adaptive";
  return MODE_CHAIN.slice(MODE_CHAIN.indexOf(start));
}

const looksLikeThinkingError = text => /thinking|effort|output_config|display|budget/i.test(text);

function authHeaders() {
  return CONFIG.AUTH_HEADER === "x-api-key"
    ? { "x-api-key": CONFIG.API_TOKEN }
    : { Authorization: `Bearer ${CONFIG.API_TOKEN}` };
}

// Разбор SSE-потока в события
async function* parseSSE(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) > -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch { /* пропускаем битые строки */ }
    }
  }
}

/**
 * Стримит ответ модели. Отдаёт события:
 *   { type: "thinking_start" } | { type: "thinking", text } | { type: "text", text }
 *   { type: "usage", input, output } | { type: "stop", reason }
 */
async function* streamCompletion({ modelId, effort, system, messages, maxOutput, signal }) {
  if (CONFIG.MOCK) { yield* mockStream(messages, effort, signal); return; }

  const model = CONFIG.MODELS.find(m => m.id === modelId);
  const modes = modesFor(model);
  let res, lastError;

  for (const mode of modes) {
    const body = { model: model.id, system, messages, stream: true };
    applyThinking(body, mode, effort, maxOutput);
    const payload = JSON.stringify(body);

    const send = () => fetch(CONFIG.UPSTREAM + "/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
        ...authHeaders(),
      },
      body: payload,
    });

    res = await send();
    // Временные сбои (перегрузка, обрыв передачи) — одна повторная попытка
    if ([408, 429, 502, 503, 529].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1200));
      if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      res = await send();
    }
    if (res.ok) { workingMode.set(model.id, mode); break; }
    const text = await res.text();
    lastError = upstreamError(res.status, text);
    if (res.status === 400 && looksLikeThinkingError(text)) continue; // пробуем следующий режим
    throw lastError;
  }
  if (!res.ok) throw lastError;

  // Сервис мог ответить обычным JSON без стрима
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const json = await res.json();
    for (const b of json.content || []) {
      if (b.type === "thinking") { yield { type: "thinking_start" }; yield { type: "thinking", text: b.thinking || "" }; }
      if (b.type === "text") yield { type: "text", text: b.text };
    }
    if (json.usage) yield { type: "usage", input: inputTokens(json.usage), output: json.usage.output_tokens || 0 };
    yield { type: "stop", reason: json.stop_reason };
    return;
  }

  let input = 0, output = 0;
  for await (const evt of parseSSE(res.body)) {
    switch (evt.type) {
      case "message_start":
        if (evt.message?.usage) { input = inputTokens(evt.message.usage); output = evt.message.usage.output_tokens || 0; }
        break;
      case "content_block_start":
        if (evt.content_block?.type === "thinking" || evt.content_block?.type === "redacted_thinking") yield { type: "thinking_start" };
        if (evt.content_block?.type === "text" && evt.content_block.text) yield { type: "text", text: evt.content_block.text };
        break;
      case "content_block_delta":
        if (evt.delta?.type === "thinking_delta") yield { type: "thinking", text: evt.delta.thinking };
        if (evt.delta?.type === "text_delta") yield { type: "text", text: evt.delta.text };
        break;
      case "message_delta":
        if (evt.usage) {
          if (evt.usage.output_tokens != null) output = evt.usage.output_tokens;
          if (evt.usage.input_tokens != null) input = inputTokens(evt.usage);
        }
        yield { type: "usage", input, output };
        if (evt.delta?.stop_reason) yield { type: "stop", reason: evt.delta.stop_reason };
        break;
      case "error":
        throw new Error(evt.error?.message || "Ошибка во время ответа");
    }
  }
}

function inputTokens(u) {
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1);
}

function upstreamError(status, text) {
  let msg = text;
  try { msg = JSON.parse(text).error?.message || text; } catch {}
  const human = {
    400: "Сервис не принял запрос",
    401: "Сервис отклонил API-ключ. Проверьте API_TOKEN в .env",
    403: "Нет доступа к этой модели",
    404: "Модель или адрес API не найдены",
    408: "Запрос оказался слишком большим или долгим. Уберите часть файлов или начните новый чат",
    413: "Запрос слишком большой. Уберите часть вложений",
    429: "Слишком много запросов к API. Подождите немного",
    500: "Ошибка на стороне API", 502: "API недоступен", 503: "API перегружен", 529: "API перегружен",
  }[status];
  // Для понятных случаев не показываем техническую приписку от сервиса
  if ([408, 413, 429, 503, 529].includes(status)) {
    const err = new Error(human);
    err.status = status;
    return err;
  }
  const err = new Error(human ? `${human} (${status}): ${String(msg).slice(0, 300)}` : `Ошибка API ${status}: ${String(msg).slice(0, 300)}`);
  err.status = status;
  return err;
}

// ---------- демо-режим ----------
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

async function* mockStream(messages, effort, signal) {
  const last = messages[messages.length - 1];
  const question = (last?.content || []).filter(b => b.type === "text").map(b => b.text).pop() || "";
  const files = (last?.content || []).filter(b => b.type !== "text" || b.text.startsWith("<file")).length;

  yield { type: "thinking_start" };
  const thoughts = `Пользователь пишет: «${question.slice(0, 120)}». ${files ? `К сообщению приложено файлов: ${files}. ` : ""}` +
    "Разберу запрос, выделю главное и отвечу структурно: короткое вступление, список шагов, пример кода и итог.";
  for (const word of thoughts.split(/(?<=\s)/)) { await sleep(effort === "low" ? 8 : 22, signal); yield { type: "thinking", text: word }; }

  const answer = [
    `Это **демо-режим**: сервер работает без API-ключа, поэтому ответ сгенерирован локально. Добавьте \`API_TOKEN\` в файл \`.env\` и перезапустите сервер — подключатся настоящие модели.`,
    ``,
    `## Что умеет интерфейс`,
    ``,
    `1. **Markdown** — заголовки, списки, таблицы, цитаты и \`код в строке\`.`,
    `2. **Блоки кода** с подсветкой, копированием, скачиванием и предпросмотром HTML.`,
    `3. **Вложения** — изображения, PDF и текстовые файлы уходят модели.`,
    `4. **Скиллы** из GitHub подмешиваются в инструкции модели.`,
    ``,
    `> Совет: нажмите Ctrl+K, чтобы быстро найти чат.`,
    ``,
    `| Сила | Когда выбирать |`,
    `|---|---|`,
    `| Быстро | простые вопросы, переводы |`,
    `| Обычно | большинство задач |`,
    `| Глубоко | архитектура, сложный код, анализ |`,
    ``,
    "```html",
    `<!doctype html>`,
    `<html lang="ru">`,
    `<body style="font-family: system-ui; display: grid; place-items: center; height: 100vh">`,
    `  <button onclick="this.textContent = 'Работает!'">Нажми меня</button>`,
    `</body>`,
    `</html>`,
    "```",
    ``,
    "```python",
    `def greet(name: str) -> str:`,
    `    # Приветствие пользователю`,
    `    return f"Привет, {name}!"`,
    ``,
    `print(greet("SQULED"))`,
    "```",
    ``,
    `Готово — задавайте следующий вопрос.`,
  ].join("\n");

  for (const token of answer.match(/[\s\S]{1,6}/g)) { await sleep(14, signal); yield { type: "text", text: token }; }
  const input = Math.round(JSON.stringify(messages).length / 4);
  yield { type: "usage", input, output: Math.round((thoughts.length + answer.length) / 4) };
  yield { type: "stop", reason: "end_turn" };
}

module.exports = { streamCompletion, buildApiMessages, buildSystemPrompt, isTextFile };
