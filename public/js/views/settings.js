/* Окно настроек: профиль, скиллы, использование, администрирование */
import { state, bus, can } from "../state.js";
import { api } from "../api.js";
import { $, esc, h, fmtCredits, fmtNum, fmtTokens, fmtDate, plural, debounce, copyText } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast, confirmDialog, openMenu } from "../ui.js";
import { openPlans } from "./plans.js";

const TABS = [
  { id: "profile", label: "Профиль", icon: "user" },
  { id: "chat", label: "Чат и модель", icon: "sliders" },
  { id: "skills", label: "Скиллы", icon: "puzzle" },
  { id: "usage", label: "Использование", icon: "chart" },
  { id: "admin", label: "Администрирование", icon: "shield", adminOnly: true },
];

let current = null;

export function openSettings(tab = "profile") {
  if (current) { current.go(tab); return; }
  const nav = h(`<div class="settings-nav"><h3>Настройки</h3></div>`);
  const main = h(`<div class="settings-main">
    <div class="modal-head"><h3></h3><button class="icon-btn" data-close aria-label="Закрыть">${icon("close")}</button></div>
    <div class="settings-body"></div></div>`);

  const wrap = h(`<div style="display:contents"></div>`);
  wrap.append(nav, main);
  const m = openModal({ className: "settings", head: false, body: wrap, onClose: () => { current = null; } });
  m.body.style.cssText = "padding:0;display:flex;flex:1;min-height:0";
  main.querySelector("[data-close]").onclick = () => m.close();

  const body = main.querySelector(".settings-body");
  const title = main.querySelector("h3");
  const tabs = TABS.filter(t => !t.adminOnly || state.user.role === "admin");

  for (const t of tabs) {
    const b = h(`<button class="nav-item" data-tab="${t.id}" type="button">${icon(t.icon, 17)}${esc(t.label)}</button>`);
    b.onclick = () => go(t.id);
    nav.appendChild(b);
  }

  function go(id) {
    const t = tabs.find(x => x.id === id) || tabs[0];
    nav.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === t.id));
    title.textContent = t.label;
    body.innerHTML = "";
    body.scrollTop = 0;
    ({ profile: renderProfile, chat: renderChatTab, skills: renderSkills, usage: renderUsage, admin: renderAdmin })[t.id](body, m);
    requestAnimationFrame(() => body.scrollTop = 0);
  }

  current = { go, close: () => m.close() };
  go(tab);
}

// ======================= профиль =======================
function renderProfile(box, modal) {
  const u = state.user;
  box.appendChild(h(`<div class="section">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <span class="avatar" style="width:52px;height:52px;border-radius:14px;font-size:20px">${esc((u.name || u.login)[0].toUpperCase())}</span>
      <div><div style="font-size:17px;font-weight:600;color:var(--ink)">${esc(u.name)}</div>
      <div class="muted" style="font-size:13px">@${esc(u.login)} · ${u.role === "admin" ? "администратор" : "пользователь"} · с ${fmtDate(u.createdAt, false)}</div></div>
    </div>
    <div class="field"><label for="sName">Имя</label><input class="input" id="sName" maxlength="40" value="${esc(u.name)}">
    <span class="hint">Так к вам будет обращаться ассистент</span></div>
  </div>`));

  // тариф
  const plan = u.plan || {};
  box.appendChild(h(`<div class="section">
    <h4>Тариф</h4>
    <div class="row-line">
      <div class="t"><b>${esc(plan.name || "Бесплатный")}</b><span>${plan.daysLeft != null ? `осталось ${plan.daysLeft} ${plural(plan.daysLeft, "день", "дня", "дней")}` : "базовый доступ"} · ${fmtCredits(plan.credits ?? u.credits)} кредитов ≈ ${fmtTokens(plan.tokensLeft || 0)} токенов</span></div>
      <button class="btn btn-outline btn-sm" id="pPlans">${icon("coins", 15)}Все тарифы</button>
    </div>
  </div>`));
  $("#pPlans", box).onclick = () => { modal.close(); openPlans(); };

  const pass = h(`<div class="section">
    <h4>Пароль</h4><p>Смена пароля не завершает уже открытые сессии.</p>
    <div class="form-grid">
      <div class="field"><label for="pOld">Текущий пароль</label><input class="input" id="pOld" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pNew">Новый пароль</label><input class="input" id="pNew" type="password" autocomplete="new-password"></div>
    </div>
    <button class="btn btn-outline btn-sm" id="pBtn" style="margin-top:12px">Сменить пароль</button>
  </div>`);
  box.appendChild(pass);

  const danger = h(`<div class="section">
    <h4>Сессия</h4><p>Выход завершит работу на этом устройстве.</p>
    <button class="btn btn-outline btn-sm" id="outBtn">${icon("logout", 15)}Выйти из аккаунта</button>
  </div>`);
  box.appendChild(danger);

  const nameInput = $("#sName", box);
  const saveName = debounce(async () => {
    const name = nameInput.value.trim();
    if (!name || name === state.user.name) return;
    try { const { user } = await api.patch("/api/me", { name }); state.user = user; bus.emit("user"); bus.emit("renderChat"); }
    catch (e) { toast(e.message, { type: "error" }); }
  }, 600);
  nameInput.oninput = saveName;
  nameInput.onblur = saveName;

  $("#pBtn", box).onclick = async e => {
    const btn = e.currentTarget;
    const cur = $("#pOld", box).value, next = $("#pNew", box).value;
    if (!cur || !next) { toast("Заполните оба поля", { type: "error" }); return; }
    btn.disabled = true;
    try {
      await api.post("/api/me/password", { current: cur, next });
      $("#pOld", box).value = $("#pNew", box).value = "";
      toast("Пароль изменён");
    } catch (ex) { toast(ex.message, { type: "error" }); }
    btn.disabled = false;
  };
  $("#outBtn", box).onclick = () => { modal.close(); bus.emit("logout"); };
}

// ======================= чат и модель =======================
function renderChatTab(box) {
  const s = state.user.settings;
  const modelOpts = `<option value="auto"${s.defaultModel === "auto" ? " selected" : ""}>Авто — подбирать под задачу</option>` +
    state.models.map(m => `<option value="${m.id}"${m.id === s.defaultModel ? " selected" : ""}${m.locked ? " disabled" : ""}>${esc(m.name)} · ×${m.mult}${m.locked ? " (закрыта)" : ""}</option>`).join("");
  const effortOpts = state.efforts.map(e => `<option value="${e.id}"${e.id === s.defaultEffort ? " selected" : ""}>${esc(e.label)} — ${esc(e.hint)}</option>`).join("");

  box.appendChild(h(`<div class="section">
    <h4>По умолчанию для новых чатов</h4><p>В режиме «Авто» модель подбирается под каждый запрос: простые вопросы уходят на быструю и дешёвую модель, сложные — на сильную. Так кредиты расходуются экономнее. В каждом чате выбор можно поменять вручную.</p>
    <div class="form-grid">
      <div class="field"><label for="sModel">Модель</label><select class="select" id="sModel">${modelOpts}</select></div>
      <div class="field"><label for="sEffort">Сила рассуждений</label><select class="select" id="sEffort">${effortOpts}</select></div>
    </div>
  </div>`));

  box.appendChild(h(`<div class="section">
    <h4>Ваши инструкции</h4><p>Ассистент будет учитывать их в каждом чате: стиль ответа, язык, формат, что о вас знать.</p>
    <textarea class="textarea" id="sPrompt" maxlength="8000" placeholder="Например: отвечай кратко, код — на Python, без лишних вступлений">${esc(s.systemPrompt || "")}</textarea>
    <div class="hint" style="margin-top:6px" id="pLen"></div>
  </div>`));

  box.appendChild(h(`<div class="section">
    <h4>Ввод</h4>
    <div class="row-line"><div class="t"><b>Enter отправляет сообщение</b><span>Если выключить — отправка по Ctrl+Enter, а Enter будет переносить строку</span></div>
    <label class="switch"><input type="checkbox" id="sEnter"${s.sendOnEnter !== false ? " checked" : ""}><span></span></label></div>
  </div>`));

  const save = async patch => {
    try { const { user } = await api.patch("/api/me", { settings: patch }); state.user = user; bus.emit("composer"); }
    catch (e) { toast(e.message, { type: "error" }); }
  };
  $("#sModel", box).onchange = e => save({ defaultModel: e.target.value });
  $("#sEffort", box).onchange = e => save({ defaultEffort: e.target.value });
  $("#sEnter", box).onchange = e => save({ sendOnEnter: e.target.checked });
  const prompt = $("#sPrompt", box);
  const len = $("#pLen", box);
  const upd = () => { len.textContent = `${prompt.value.length} из 8000 символов`; };
  prompt.oninput = () => { upd(); savePrompt(); };
  const savePrompt = debounce(() => save({ systemPrompt: prompt.value }), 700);
  prompt.onblur = () => save({ systemPrompt: prompt.value });
  upd();
}

// ======================= скиллы =======================
function renderSkills(box, modal) {
  const allowed = can("skills");

  if (!allowed) {
    box.appendChild(h(`<div class="section" style="padding-top:8px">
      <div class="lock-note">${icon("key", 20)}
        <div><b>Скиллы доступны на тарифе PREM.</b><br>Это инструкции, по которым ассистент работает над конкретным видом задач: вёрстка, код, письма, разбор данных.</div>
        <button class="btn btn-accent btn-sm" id="skPlans">Тарифы</button></div>
    </div>`));
    $("#skPlans", box).onclick = () => { modal.close(); openPlans("prem"); };
  }

  // каталог готовых скиллов
  if (state.skillCatalog?.length) {
    const cat = h(`<div class="section"${allowed ? "" : ' style="opacity:.6;pointer-events:none"'}>
      <h4>Готовые скиллы</h4><p>Подключаются в один клик. Ассистент будет следовать им, когда задача подходит.</p>
      <div class="cat-grid"></div></div>`);
    const grid = cat.querySelector(".cat-grid");
    for (const c of state.skillCatalog) {
      const added = state.skills.some(s => s.builtin === c.key);
      const card = h(`<button class="cat-card" type="button"${added ? " disabled" : ""}>
        <span class="ci">${icon(c.icon || "puzzle", 17)}</span>
        <span style="min-width:0"><b>${esc(c.name)}${added ? ` <span class="added">· подключён</span>` : ""}</b><span>${esc(c.description)}</span></span>
      </button>`);
      card.onclick = async () => {
        card.disabled = true;
        try {
          const { skills } = await api.post("/api/skills/builtin", { key: c.key });
          state.skills = skills;
          bus.emit("user"); bus.emit("composer");
          toast(`Скилл «${c.name}» подключён`);
          current.go("skills");
        } catch (e) { card.disabled = false; toast(e.message, { type: "error" }); }
      };
      grid.appendChild(card);
    }
    box.appendChild(cat);
  }

  box.appendChild(h(`<div class="section"${allowed ? "" : ' style="opacity:.6;pointer-events:none"'}>
    <h4>Свой скилл с GitHub</h4>
    <p>Скилл — это папка с инструкциями (SKILL.md) в репозитории GitHub. Включённые скиллы добавляются к инструкциям модели в каждом чате.</p>
    <div class="skill-add-row">
      <input class="input" id="skUrl" placeholder="https://github.com/владелец/репозиторий" spellcheck="false">
      <button class="btn btn-primary" id="skAdd">${icon("plus", 16)}Добавить</button>
    </div>
    <div class="hint" style="margin-top:8px" id="skHint">Можно указать и папку: .../tree/main/skills/название</div>
    <button class="btn btn-ghost btn-sm" id="skManual" style="margin-top:8px;margin-left:-10px">${icon("pen", 15)}Или вставить текст вручную</button>
  </div>`));
  const list = h(`<div class="section" style="border-bottom:none"${allowed ? "" : ' style="opacity:.6"'}><div class="row-line" style="margin-bottom:8px"><h4 style="margin:0">Установленные</h4><span class="badge" id="skCount"></span></div><div class="skill-list" id="skList"></div></div>`);
  box.appendChild(list);

  const render = () => {
    const el = $("#skList", box);
    el.innerHTML = "";
    $("#skCount", box).textContent = state.skills.length ? `${state.skills.length} ${plural(state.skills.length, "скилл", "скилла", "скиллов")}` : "";
    if (!state.skills.length) {
      el.appendChild(h(`<div class="empty-box">Пока ничего не подключено.<br>Начните с готовых скиллов выше.</div>`));
      return;
    }
    for (const s of state.skills) {
      const card = h(`<div class="skill-card${s.enabled ? "" : " off"}">
        <span class="skill-icon">${icon("puzzle", 18)}</span>
        <div class="skill-body">
          <b>${esc(s.name)}</b>
          ${s.description ? `<p>${esc(s.description)}</p>` : ""}
          <div class="src">${s.url ? `${esc(s.path || "SKILL.md")} · ${esc(s.url.replace("https://github.com/", ""))}` : "Добавлен вручную"} · ${fmtNum(s.chars)} символов</div>
        </div>
        <div class="skill-side">
          <button class="icon-btn sm" data-act="view" title="Посмотреть текст">${icon("eye", 15)}</button>
          <button class="icon-btn sm" data-act="del" title="Удалить">${icon("trash", 15)}</button>
          <label class="switch" title="${s.enabled ? "Выключить" : "Включить"}"><input type="checkbox"${s.enabled ? " checked" : ""}><span></span></label>
        </div></div>`);
      card.querySelector("input").onchange = async e => {
        s.enabled = e.target.checked;
        card.classList.toggle("off", !s.enabled);
        bus.emit("composer");
        try { await api.patch(`/api/skills/${s.id}`, { enabled: s.enabled }); } catch (ex) { toast(ex.message, { type: "error" }); }
      };
      card.querySelector("[data-act=view]").onclick = async () => {
        try {
          const { skill } = await api.get(`/api/skills/${s.id}`);
          openModal({ title: skill.name, body: h(`<div class="skill-view">${esc(skill.content)}</div>`), className: "" });
        } catch (ex) { toast(ex.message, { type: "error" }); }
      };
      card.querySelector("[data-act=del]").onclick = async () => {
        if (!await confirmDialog({ title: "Удалить скилл?", text: s.name, ok: "Удалить", danger: true })) return;
        state.skills = state.skills.filter(x => x.id !== s.id);
        render();
        bus.emit("user");
        bus.emit("composer");
        try { await api.del(`/api/skills/${s.id}`); } catch (ex) { toast(ex.message, { type: "error" }); }
      };
      el.appendChild(card);
    }
  };
  render();

  const input = $("#skUrl", box), btn = $("#skAdd", box), hint = $("#skHint", box);
  const add = async () => {
    const url = input.value.trim();
    if (!url) return;
    btn.disabled = true;
    const prev = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>`;
    hint.textContent = "Ищу SKILL.md в репозитории…";
    try {
      const { added, skills } = await api.post("/api/skills", { url });
      state.skills = skills;
      input.value = "";
      hint.textContent = added ? `Добавлено: ${added}` : "Эти скиллы уже подключены";
      render();
      bus.emit("user");
      bus.emit("composer");
      if (added) toast(`Подключено ${added} ${plural(added, "скилл", "скилла", "скиллов")}`);
    } catch (e) { hint.textContent = e.message; toast(e.message, { type: "error" }); }
    btn.disabled = false;
    btn.innerHTML = prev;
  };
  btn.onclick = add;
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };

  $("#skManual", box).onclick = () => {
    const form = h(`<div style="display:contents">
      <div class="field" style="margin-bottom:12px"><label for="mName">Название</label><input class="input" id="mName" maxlength="60" placeholder="Например, Стиль писем" autofocus></div>
      <div class="field"><label for="mText">Текст инструкции</label><textarea class="textarea" id="mText" style="min-height:200px" placeholder="Опишите, как ассистент должен действовать в этой задаче"></textarea></div>
    </div>`);
    const foot = h(`<div style="display:contents"><button class="btn btn-ghost">Отмена</button><button class="btn btn-primary">Добавить</button></div>`);
    const dlg = openModal({ title: "Свой скилл", body: form, footer: foot });
    foot.children[0].onclick = () => dlg.close();
    foot.children[1].onclick = async () => {
      const name = form.querySelector("#mName").value.trim();
      const content = form.querySelector("#mText").value.trim();
      if (!content) { toast("Добавьте текст инструкции", { type: "error" }); return; }
      try {
        const { skills } = await api.post("/api/skills", { name, content });
        state.skills = skills;
        dlg.close();
        render();
        bus.emit("user");
        bus.emit("composer");
        toast("Скилл добавлен");
      } catch (e) { toast(e.message, { type: "error" }); }
    };
  };
}

// ======================= использование =======================
async function renderUsage(box) {
  box.appendChild(h(`<div class="section" style="padding-top:8px"><div class="muted">Загрузка…</div></div>`));
  let data;
  try { data = await api.get("/api/usage"); }
  catch (e) { box.innerHTML = `<div class="section">${esc(e.message)}</div>`; return; }
  box.innerHTML = "";

  box.appendChild(h(`<div class="section" style="padding-top:8px">
    <div class="stats">
      <div class="stat accent"><span>Остаток</span><b>${fmtCredits(data.credits)}</b></div>
      <div class="stat"><span>Сегодня</span><b>${fmtCredits(data.today)}</b></div>
      <div class="stat"><span>30 дней</span><b>${fmtCredits(data.month)}</b></div>
      <div class="stat"><span>Токенов на выход</span><b>${fmtNum(data.tokens.output)}</b></div>
    </div>
  </div>`));

  // расход по дням за 2 недели
  const days = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const from = start.getTime() - i * 86400000;
    const cost = data.entries.filter(e => e.at >= from && e.at < from + 86400000).reduce((s, e) => s + e.cost, 0);
    days.push({ from, cost });
  }
  const max = Math.max(0.01, ...days.map(d => d.cost));
  box.appendChild(h(`<div class="section">
    <h4>Расход за две недели</h4>
    <div class="spark-bars">${days.map((d, i) => `<div style="height:${Math.max(2, (d.cost / max) * 100)}%;animation-delay:${i * 0.02}s${i === days.length - 1 ? ';' : ''}" class="${i === days.length - 1 ? "today" : ""}" title="${fmtDate(d.from, false)}: ${fmtCredits(d.cost)} кр."></div>`).join("")}</div>
    <div class="spark-axis"><span>${fmtDate(days[0].from, false)}</span><span>сегодня</span></div>
  </div>`));

  box.appendChild(h(`<div class="section" style="border-bottom:none">
    <h4>Последние запросы</h4>
    ${data.entries.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th>Когда</th><th>Чат</th><th>Модель</th><th class="num">Токены</th><th class="num">Кредиты</th></tr></thead>
      <tbody>${data.entries.slice(0, 40).map(e => `<tr>
        <td class="muted" style="white-space:nowrap">${fmtDate(e.at)}</td>
        <td class="ell" title="${esc(e.chatTitle)}">${esc(e.chatTitle)}</td>
        <td class="muted" style="white-space:nowrap">${esc((state.models.find(m => m.id === e.model)?.name || e.model).replace("Claude ", ""))}</td>
        <td class="num muted">${fmtNum(e.input)} / ${fmtNum(e.output)}</td>
        <td class="num"><b>${fmtCredits(e.cost)}</b></td></tr>`).join("")}</tbody></table></div>
      <div class="hint" style="margin-top:10px">Столбец «Токены» — вход / выход. Списание зависит от модели и объёма.</div>`
    : `<div class="empty-box">Пока нет запросов</div>`}
  </div>`));
}

// ======================= администрирование =======================
async function renderAdmin(box) {
  box.appendChild(h(`<div class="section" style="padding-top:8px"><div class="muted">Загрузка…</div></div>`));
  let users, planList, auditLog;
  try { ({ users, plans: planList, audit: auditLog } = await api.get("/api/admin/users")); }
  catch (e) { box.innerHTML = `<div class="section">${esc(e.message)}</div>`; return; }
  box.innerHTML = "";

  const paid = users.filter(u => u.plan?.id && u.plan.id !== "free");
  const totalSpent = users.reduce((s, u) => s + u.spent, 0);
  box.appendChild(h(`<div class="section" style="padding-top:8px"><div class="stats">
    <div class="stat"><span>Пользователей</span><b>${users.length}</b></div>
    <div class="stat accent"><span>С тарифом</span><b>${paid.length}</b></div>
    <div class="stat"><span>Активных за сутки</span><b>${users.filter(u => u.lastActive > Date.now() - 86400000).length}</b></div>
    <div class="stat"><span>Потрачено кредитов</span><b>${fmtCredits(totalSpent)}</b></div>
  </div></div>`));

  const section = h(`<div class="section">
    <div class="row-line" style="margin-bottom:10px">
      <div><h4 style="margin:0">Пользователи</h4><p style="margin:2px 0 0">Тариф выдаётся в меню справа. Кредиты можно править прямо в таблице.</p></div>
      <button class="btn btn-primary btn-sm" id="admAdd">${icon("plus", 15)}Создать</button>
    </div>
    <div class="table-scroll"><table class="table"><thead><tr>
      <th>Пользователь</th><th>Тариф</th><th class="num">Токенов</th><th class="num">Кредиты</th><th></th>
    </tr></thead><tbody></tbody></table></div></div>`);
  const tbody = section.querySelector("tbody");
  box.appendChild(section);

  $("#admAdd", section).onclick = () => createUserDialog(planList);

  for (const u of users) {
    const plan = u.plan || { id: "free", name: "Бесплатный" };
    const left = plan.daysLeft != null ? `${plan.daysLeft} дн.` : "";
    const row = h(`<tr${u.disabled ? ' style="opacity:.55"' : ""}>
      <td><div style="display:flex;align-items:center;gap:9px"><span class="avatar" style="width:26px;height:26px;border-radius:7px;font-size:11px">${esc((u.name || u.login)[0].toUpperCase())}</span>
        <div style="line-height:1.25"><b style="font-weight:500">${esc(u.name)}</b><div class="muted" style="font-size:11.5px">@${esc(u.login)}${u.role === "admin" ? " · админ" : ""}${u.disabled ? " · заблокирован" : ""}</div></div></div></td>
      <td><span class="badge ${plan.id === "prem" ? "accent" : plan.id === "pro" ? "" : ""}">${esc(plan.name)}</span>${left ? `<div class="muted" style="font-size:11px;margin-top:2px">${esc(left)}</div>` : ""}</td>
      <td class="num muted">${fmtNum((u.tokens || 0) / 1000)}к</td>
      <td class="num"><input class="input credit-input" type="number" step="50" min="0" value="${u.credits}"></td>
      <td><button class="icon-btn sm" aria-label="Действия">${icon("dots", 15)}</button></td></tr>`);

    const input = row.querySelector("input");
    const patch = async body => {
      try {
        const { user } = await api.patch(`/api/admin/users/${u.id}`, body);
        Object.assign(u, user);
        if (user.id === state.user.id) { state.user = { ...state.user, ...user }; bus.emit("user"); bus.emit("composer"); }
        input.value = user.credits;
        toast("Сохранено");
        return user;
      } catch (e) { toast(e.message, { type: "error" }); throw e; }
    };
    input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); patch({ credits: Number(input.value) }); input.blur(); } };
    input.onblur = () => { if (Number(input.value) !== u.credits) patch({ credits: Number(input.value) }); };

    const grant = async (planId, period) => {
      const p = planList.find(x => x.id === planId);
      const label = period === "year" ? "на год" : "на месяц";
      if (!await confirmDialog({
        title: `Выдать ${p.name} ${label}?`,
        text: `${u.name} получит ${fmtNum(p.credits * (period === "year" ? 12 : 1))} кредитов и доступ на ${period === "year" ? "365" : "30"} дней.`,
        ok: "Выдать",
      })) return;
      await patch({ plan: planId, period });
      current.go("admin");
    };

    row.querySelector("button").onclick = e => openMenu(e.currentTarget, [
      { heading: "Выдать тариф" },
      ...planList.filter(p => p.id !== "free").flatMap(p => [
        { label: `${p.name} — месяц`, hint: `${fmtNum(p.credits)} кр. · ${fmtNum(p.price)} ₽`, icon: "coins", onClick: () => grant(p.id, "month") },
        { label: `${p.name} — год`, hint: `${fmtNum(p.credits * 12)} кр. · ${fmtNum(p.yearPrice)} ₽`, icon: "coins", onClick: () => grant(p.id, "year") },
      ]),
      { label: "Снять тариф", icon: "ban", onClick: async () => { await patch({ plan: "free" }); current.go("admin"); } },
      { sep: true },
      { heading: "Кредиты" },
      { label: "Добавить 100", icon: "plus", onClick: () => patch({ addCredits: 100 }) },
      { label: "Добавить 500", icon: "plus", onClick: () => patch({ addCredits: 500 }) },
      ...(u.id === state.user.id ? [] : [
        { sep: true },
        { label: "Сбросить пароль", icon: "key", onClick: () => resetPasswordDialog(u, patch) },
        { label: u.role === "admin" ? "Снять права админа" : "Сделать админом", icon: "shield", onClick: async () => { await patch({ role: u.role === "admin" ? "user" : "admin" }); current.go("admin"); } },
        { label: u.disabled ? "Разблокировать" : "Заблокировать", icon: "ban", danger: !u.disabled, onClick: async () => {
          if (!u.disabled && !await confirmDialog({ title: "Заблокировать?", text: `${u.name} не сможет войти, а открытые сессии завершатся.`, ok: "Заблокировать", danger: true })) return;
          await patch({ disabled: !u.disabled });
          current.go("admin");
        } },
        { label: "Удалить аккаунт", icon: "trash", danger: true, onClick: async () => {
          if (!await confirmDialog({ title: "Удалить аккаунт?", text: `${u.name} и все его чаты будут удалены без возможности восстановления.`, ok: "Удалить", danger: true })) return;
          try { await api.del(`/api/admin/users/${u.id}`); toast("Аккаунт удалён"); current.go("admin"); }
          catch (e) { toast(e.message, { type: "error" }); }
        } },
      ]),
    ], { align: "end", width: 250 });
    tbody.appendChild(row);
  }

  // журнал действий
  if (auditLog?.length) {
    box.appendChild(h(`<div class="section" style="border-bottom:none">
      <h4>Журнал действий</h4><p>Последние изменения, сделанные администраторами.</p>
      <div class="table-scroll"><table class="table"><tbody>${auditLog.slice(0, 25).map(e => `<tr>
        <td class="muted" style="white-space:nowrap">${fmtDate(e.at)}</td>
        <td>${esc(e.admin)}</td>
        <td>${esc(auditText(e))}</td>
        <td class="muted">${esc(e.target || "")}</td></tr>`).join("")}</tbody></table></div></div>`));
  }
}

function auditText(e) {
  const names = { plan: "выдал тариф", credits: "изменил кредиты", role: "изменил роль", disable: "заблокировал", enable: "разблокировал", create: "создал аккаунт", delete: "удалил аккаунт", password: "сбросил пароль" };
  let t = names[e.action] || e.action;
  if (e.action === "plan") t += ` ${e.plan}${e.period === "year" ? " на год" : " на месяц"}`;
  if (e.action === "credits") t += e.add !== undefined ? `: +${e.add}` : `: ${e.set}`;
  if (e.action === "role") t += `: ${e.role}`;
  return t;
}

function createUserDialog(planList) {
  const form = h(`<div style="display:contents">
    <div class="form-grid">
      <div class="field"><label for="nLogin">Логин</label><input class="input" id="nLogin" autocomplete="off" spellcheck="false" autofocus></div>
      <div class="field"><label for="nName">Имя</label><input class="input" id="nName" maxlength="40"></div>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label for="nPass">Пароль</label><input class="input" id="nPass" autocomplete="off"></div>
      <div class="field"><label for="nPlan">Тариф</label><select class="select" id="nPlan">
        ${planList.map(p => `<option value="${p.id}">${esc(p.name)}${p.price ? ` · ${fmtNum(p.credits)} кр.` : ""}</option>`).join("")}
      </select></div>
    </div>
    <div class="field" style="margin-top:12px"><label for="nPeriod">Срок</label><select class="select" id="nPeriod">
      <option value="month">Месяц</option><option value="year">Год</option></select></div>
  </div>`);
  const foot = h(`<div style="display:contents"><button class="btn btn-ghost">Отмена</button><button class="btn btn-primary">Создать</button></div>`);
  const dlg = openModal({ title: "Новый пользователь", body: form, footer: foot });
  // пароль предлагаем сразу, чтобы не придумывать
  form.querySelector("#nPass").value = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase();
  foot.children[0].onclick = () => dlg.close();
  foot.children[1].onclick = async () => {
    const login = form.querySelector("#nLogin").value.trim();
    const password = form.querySelector("#nPass").value;
    const name = form.querySelector("#nName").value.trim();
    const plan = form.querySelector("#nPlan").value;
    const period = form.querySelector("#nPeriod").value;
    if (!login || !password) { toast("Заполните логин и пароль", { type: "error" }); return; }
    try {
      await api.post("/api/admin/users", { login, password, name, plan, period });
      dlg.close();
      await copyText(`Логин: ${login}\nПароль: ${password}`);
      toast("Аккаунт создан, данные для входа скопированы");
      current.go("admin");
    } catch (e) { toast(e.message, { type: "error" }); }
  };
}

function resetPasswordDialog(u, patch) {
  const pass = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase();
  const form = h(`<div style="display:contents">
    <p style="margin:0 0 12px">Новый пароль для <b>${esc(u.login)}</b>. Все его сессии будут завершены.</p>
    <div class="field"><input class="input" id="rPass" value="${pass}"></div>
  </div>`);
  const foot = h(`<div style="display:contents"><button class="btn btn-ghost">Отмена</button><button class="btn btn-primary">Сменить</button></div>`);
  const dlg = openModal({ title: "Сброс пароля", body: form, footer: foot });
  foot.children[0].onclick = () => dlg.close();
  foot.children[1].onclick = async () => {
    const v = form.querySelector("#rPass").value;
    try { await patch({ resetPassword: v }); dlg.close(); await copyText(`Логин: ${u.login}\nПароль: ${v}`); toast("Пароль изменён и скопирован"); }
    catch {}
  };
}

export function openShortcuts() {
  const rows = [
    ["Новый чат", "Ctrl + Shift + O"],
    ["Поиск и команды", "Ctrl + K"],
    ["Скрыть или показать панель", "Ctrl + \\"],
    ["Отправить сообщение", "Enter"],
    ["Перенос строки", "Shift + Enter"],
    ["Вернуть последнее сообщение в поле", "↑ в пустом поле"],
    ["Остановить ответ", "Esc"],
    ["Настройки", "Ctrl + ,"],
    ["Закрыть окно или меню", "Esc"],
  ];
  openModal({
    title: "Горячие клавиши",
    body: `<table class="table" style="margin:-6px 0 4px">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="num">${b.split(" + ").map(k => `<kbd>${esc(k)}</kbd>`).join(" ")}</td></tr>`).join("")}</table>`,
  });
}
