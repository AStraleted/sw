/* Точка входа: загрузка профиля, маршруты, отправка сообщений */
import { state, bus, currentChat, activeModel, activeEffort, isStreaming } from "./state.js";
import { api } from "./api.js";
import { $, h, esc, storage } from "./utils.js";

import { toast, hasModal, confirmDialog } from "./ui.js";
import { showAuth, hideAuth } from "./views/auth.js";
import { initSidebar, renderChats, renderUser, chatMenu, toggleSidebar } from "./views/sidebar.js";
import { initMessages, renderChat, beginStream, streamEvent, endStream } from "./views/messages.js";
import { initComposer, renderComposer, focusInput, getText, clearInput, setText, clearFiles, readyAttachmentIds, filesBusy, pending } from "./views/composer.js";
import { openPalette } from "./views/palette.js";
import { openSettings, openShortcuts } from "./views/settings.js";
import { openPlans } from "./views/plans.js";

const actions = {
  newChat: () => openChat(null),
  openSearch: () => openPalette(actions),
  openSettings,
  openShortcuts,
  openPlans,
  logout,
  send,
  stop,
};

// ======================= запуск =======================
init();

async function init() {
  api.onUnauthorized = () => { if (state.user) { state.user = null; location.reload(); } };
  let data;
  try { data = await api.get("/api/me"); }
  catch (e) {
    if (e.status !== 401) { showFatal(e.message); return; }
    const { config } = await api.get("/api/config").catch(() => ({ config: {} }));
    showAuth(config, onLogin);
    return;
  }
  start(data);
}

function showFatal(message) {
  document.body.innerHTML = `<div style="height:100%;display:grid;place-items:center;text-align:center;padding:30px">
    <div><h1 style="font-family:var(--serif);font-weight:500">Сервер недоступен</h1>
    <p style="color:var(--muted)">${esc(message)}</p>
    <p style="color:var(--muted);font-size:13px">Запустите его командой <code style="font-family:var(--mono)">npm start</code> и обновите страницу.</p></div></div>`;
}

async function onLogin(user) {
  hideAuth();
  const data = await api.get("/api/me");
  start(data);
}

async function start(data) {
  Object.assign(state, { user: data.user, models: data.models, efforts: data.efforts, config: data.config, plans: data.plans || [] });
  hideAuth();
  $("#app").classList.remove("hidden");

  initSidebar(actions);
  initMessages();
  initComposer(actions);
  initShortcuts();
  renderUser();

  bus.on("openChat", openChat);
  bus.on("send", send);
  bus.on("regenerate", () => send({ mode: "regenerate" }));
  bus.on("editMessage", ({ messageId, text }) => send({ mode: "edit", messageId, text }));
  bus.on("logout", logout);
  bus.on("chatRenamed", () => renderTitle());

  // подгружаем список чатов и скиллы
  try {
    const [{ chats }, skillData] = await Promise.all([api.get("/api/chats"), api.get("/api/skills")]);
    state.chats = chats;
    state.skills = skillData.skills;
    state.skillCatalog = skillData.catalog || [];
  } catch (e) { toast(e.message, { type: "error" }); }

  renderUser();
  renderChats();
  renderComposer();

  const last = storage.get("lastChat", null);
  openChat(state.chats.some(c => c.id === last) ? last : null);
  focusInput();
  animateIn();
}

function animateIn() {
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $("#sidebar").animate([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "cubic-bezier(.22,.8,.24,1)" });
    $("#main").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" });
  }
}

// ======================= навигация =======================
let firstRender = true;

async function openChat(id) {
  if (!firstRender && state.currentId === id && (id === null ? !currentChat() : state.chatCache.has(id))) { focusInput(); return; }
  firstRender = false;
  state.currentId = id;
  storage.set("lastChat", id);
  renderChats();
  renderTitle();

  if (!id) {
    state.draft = { model: null, effort: null };
    renderChat();
    renderComposer();
    focusInput();
    return;
  }
  if (!state.chatCache.has(id)) {
    renderLoading();
    try {
      const { chat } = await api.get(`/api/chats/${id}`);
      state.chatCache.set(id, chat);
    } catch (e) {
      toast(e.message, { type: "error" });
      state.currentId = null;
      renderChat();
      return;
    }
    if (state.currentId !== id) return; // пользователь уже переключился
  }
  renderChat();
  renderTitle();
  renderComposer();
  focusInput();
}

function renderLoading() {
  $("#chatArea").classList.remove("is-empty");
  $("#hero").classList.add("hidden");
  $("#messages").innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)"><span class="spinner" style="display:inline-block"></span></div>`;
}

function renderTitle() {
  const slot = $("#titleSlot");
  const chat = currentChat();
  const summary = state.chats.find(c => c.id === state.currentId);
  slot.innerHTML = "";
  $("#chatMenuBtn").classList.toggle("hidden", !chat);
  if (!chat) return;
  const title = summary?.title || chat.title;
  const btn = h(`<button class="chat-title-btn" type="button" title="Переименовать">${esc(title)}</button>`);
  btn.onclick = () => startTitleEdit(btn, summary || chat);
  slot.appendChild(btn);
  $("#chatMenuBtn").onclick = e => chatMenu(e.currentTarget, summary || chat, null);
}

function startTitleEdit(btn, c) {
  const input = h(`<input class="chat-title-input" value="${esc(c.title)}" maxlength="120">`);
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== c.title) {
      c.title = v;
      const full = state.chatCache.get(c.id);
      if (full) full.title = v;
      const s = state.chats.find(x => x.id === c.id);
      if (s) s.title = v;
      renderChats();
      try { await api.patch(`/api/chats/${c.id}`, { title: v }); } catch (e) { toast(e.message, { type: "error" }); }
    }
    renderTitle();
  };
  input.onblur = () => finish(true);
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
}

// ======================= отправка =======================
async function send({ mode = "new", messageId, text } = {}) {
  if (isStreaming()) return;
  if (filesBusy()) { toast("Дождитесь загрузки файлов", { type: "info" }); return; }
  if (state.user.credits <= 0) { toast("Кредиты закончились. Обратитесь к администратору", { type: "error" }); return; }

  const body = { mode, model: activeModel(), effort: activeEffort() };
  if (mode === "new") {
    body.text = getText();
    body.attachments = readyAttachmentIds();
    if (!body.text && !body.attachments.length) return;
  } else if (mode === "edit") {
    body.text = text;
    body.messageId = messageId;
  }

  // новый чат создаём на сервере в момент первой отправки
  let chat = currentChat();
  if (!chat) {
    try {
      const res = await api.post("/api/chats", { model: body.model, effort: body.effort });
      chat = res.chat;
      state.chatCache.set(chat.id, chat);
      state.chats.unshift({ ...chat, count: 0 });
      state.currentId = chat.id;
      storage.set("lastChat", chat.id);
      renderChats();
      renderTitle();
    } catch (e) { toast(e.message, { type: "error" }); return; }
  }

  const chatId = chat.id;
  if (mode === "new") { clearInput(); clearFiles(); }

  const controller = new AbortController();
  let stream = null;

  try {
    await api.stream(`/api/chats/${chatId}/messages`, body, evt => {
      const viewing = state.currentId === chatId;
      if (evt.type === "start") {
        // приводим локальный чат в соответствие с сервером
        if (mode !== "new") {
          const cut = chat.messages.findIndex(m => m.id === evt.userMessage.id);
          if (cut > -1) chat.messages.splice(cut);
        }
        chat.messages.push(evt.userMessage, evt.assistantMessage);
        chat.title = evt.chat.title;
        const s = state.chats.find(c => c.id === chatId);
        if (s) Object.assign(s, evt.chat);
        renderChats();
        renderTitle();
        if (viewing) {
          if (mode !== "new") renderChat();
          stream = beginStream(chat, mode === "new" ? evt.userMessage : null, evt.assistantMessage);
          state.streams.set(chatId, { controller, stream });
          renderComposer();
        } else {
          state.streams.set(chatId, { controller, stream: null });
        }
      } else if (evt.type === "done") {
        const idx = chat.messages.findIndex(m => m.id === evt.message.id);
        if (idx > -1) chat.messages[idx] = evt.message;
        state.user.credits = evt.credits;
        if (evt.plan) state.user.plan = evt.plan;
        const s = state.chats.find(c => c.id === chatId);
        if (s) Object.assign(s, evt.chat);
        if (stream && state.currentId === chatId) endStream(stream, evt.message, chat);
        state.streams.delete(chatId);
        renderUser();
        renderChats();
        renderComposer();
        if (state.currentId !== chatId) toast(`Ответ готов: ${evt.chat.title}`, { type: "info" });
      } else if (stream) {
        streamEvent(stream, evt);
      } else {
        // чат открыт не на экране — просто копим текст
        const m = chat.messages[chat.messages.length - 1];
        if (!m || m.role !== "assistant") return;
        if (evt.type === "thinking") m.reasoning = (m.reasoning || "") + evt.text;
        if (evt.type === "text") m.content = (m.content || "") + evt.text;
        if (evt.type === "error") m.error = evt.message;
      }
    }, controller.signal);
  } catch (e) {
    state.streams.delete(chatId);
    renderComposer();
    if (state.currentId === chatId) renderChat();
    toast(e.message, { type: "error" });
    if (mode === "new" && body.text && !getText()) setText(body.text); // не теряем набранное
    return;
  }

  // если поток оборвался без события done
  if (state.streams.has(chatId)) {
    state.streams.delete(chatId);
    renderComposer();
    if (state.currentId === chatId) renderChat();
  }
}

function stop() {
  const live = state.streams.get(state.currentId);
  if (!live) return;
  live.controller.abort();
  state.streams.delete(state.currentId);
  renderComposer();
  // сервер сохранит то, что успел; перечитываем чат
  setTimeout(async () => {
    try {
      const { chat } = await api.get(`/api/chats/${state.currentId}`);
      state.chatCache.set(chat.id, chat);
      if (state.currentId === chat.id) renderChat();
      const me = await api.get("/api/me");
      state.user = me.user;
      renderUser();
    } catch {}
  }, 400);
}

async function logout() {
  if (isStreaming() && !await confirmDialog({ title: "Выйти?", text: "Ответ ещё генерируется. Выйти из аккаунта?", ok: "Выйти", danger: true })) return;
  try { await api.post("/api/auth/logout"); } catch {}
  storage.set("lastChat", null);
  location.reload();
}

// ======================= горячие клавиши =======================
function initShortcuts() {
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);

    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); if (!hasModal()) openPalette(actions); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); actions.newChat(); }
    else if (mod && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
    else if (mod && e.key === ",") { e.preventDefault(); openSettings("profile"); }
    else if (e.key === "Escape" && !hasModal() && isStreaming()) { e.preventDefault(); stop(); }
    else if (e.key === "/" && !typing && !hasModal()) { e.preventDefault(); focusInput(); }
  });

  // не теряем набранный текст при случайном закрытии вкладки
  addEventListener("beforeunload", e => {
    if (isStreaming() || getText() || pending.length) { e.preventDefault(); e.returnValue = ""; }
  });
}
