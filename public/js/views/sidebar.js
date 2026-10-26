/* Боковая панель: список чатов, свёртывание, меню пользователя */
import { state, bus, isStreaming } from "../state.js";
import { api } from "../api.js";
import { $, esc, h, dateGroup, fmtCredits, fmtTokens, plural, storage, isMobile } from "../utils.js";
import { icon } from "../icons.js";
import { wordmark } from "../logo.js";
import { openMenu, confirmDialog, toast } from "../ui.js";

export function initSidebar(actions) {
  $("#brand").innerHTML = wordmark(24);
  const put = (sel, name, size) => { const el = $(sel); if (el) el.innerHTML = icon(name, size); };
  put("#collapseBtn", "sidebar");
  put("#expandBtn", "sidebar");
  put("#newChatTop", "compose");
  put("#newChatCollapsed", "compose");
  put("#newChatMobile", "compose");
  put("#mobileMenuBtn", "menu");
  put("#chatMenuBtn", "dots");
  put("#scrollDown", "arrowDown", 16);
  $("#searchBtn").querySelector("[data-i=search]").innerHTML = icon("search", 15);
  for (const el of document.querySelectorAll(".nav-item [data-i]")) el.innerHTML = icon(el.dataset.i, 17);

  applyCollapsed();
  $("#collapseBtn").onclick = toggleSidebar;
  $("#expandBtn").onclick = toggleSidebar;
  $("#mobileMenuBtn").onclick = () => $("#app").classList.toggle("sidebar-open");
  $("#sidebarBackdrop").onclick = () => $("#app").classList.remove("sidebar-open");

  for (const id of ["#newChatTop", "#newChatCollapsed", "#newChatMobile", "#navNew"]) $(id).onclick = () => actions.newChat();
  $("#searchBtn").onclick = () => actions.openSearch();
  $("#navSkills").onclick = () => actions.openSettings("skills");
  $("#navUsage").onclick = () => actions.openSettings("usage");
  $("#navAdmin").onclick = () => actions.openSettings("admin");
  $("#navPlans").onclick = () => actions.openPlans();
  $("#planChip").onclick = () => actions.openPlans();
  const credit = $("#creditCard");
  credit.onclick = () => actions.openSettings("usage");
  credit.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); actions.openSettings("usage"); } };

  $("#userBtn").onclick = e => openMenu(e.currentTarget, [
    { heading: state.user.login + (state.user.role === "admin" ? " · администратор" : "") },
    { label: "Настройки", icon: "settings", onClick: () => actions.openSettings("profile") },
    { label: "Скиллы", icon: "puzzle", right: String(state.skills.length || ""), onClick: () => actions.openSettings("skills") },
    { label: "Использование", icon: "chart", onClick: () => actions.openSettings("usage") },
    { label: "Тарифы", icon: "coins", onClick: () => actions.openPlans() },
    ...(state.user.role === "admin" ? [{ label: "Администрирование", icon: "shield", onClick: () => actions.openSettings("admin") }] : []),
    { sep: true },
    { label: "Горячие клавиши", icon: "keyboard", onClick: () => actions.openShortcuts() },
    { label: "Выйти", icon: "logout", danger: true, onClick: actions.logout },
  ], { align: "start", placement: "top", width: 236 });

  bus.on("chats", renderChats);
  bus.on("user", renderUser);
}

export function toggleSidebar() {
  if (isMobile()) { $("#app").classList.toggle("sidebar-open"); return; }
  state.sidebarCollapsed = !state.sidebarCollapsed;
  storage.set("sidebarCollapsed", state.sidebarCollapsed);
  applyCollapsed();
}

function applyCollapsed() {
  $("#app").classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
}

export function renderUser() {
  const u = state.user;
  if (!u) return;
  $("#avatar").textContent = (u.name || u.login).trim()[0].toUpperCase();
  $("#userName").textContent = u.name || u.login;
  $("#userLogin").textContent = u.role === "admin" ? "Администратор" : "@" + u.login;
  $("#navAdmin").classList.toggle("hidden", u.role !== "admin");

  // плашка тарифа
  const plan = u.plan || { id: "free", name: "Бесплатный" };
  const chip = $("#planChip");
  chip.className = `plan-chip ${plan.id}`;
  const left = plan.id === "free" ? "Базовый доступ"
    : plan.daysLeft != null ? `${plan.daysLeft} ${plural(plan.daysLeft, "день", "дня", "дней")} осталось`
    : "Без ограничения срока";
  chip.innerHTML = `<span class="pc-badge">${esc(plan.name)}</span><span class="pc-text"><b>${plan.id === "free" ? "Открыть больше" : "Тариф активен"}</b>${esc(left)}</span>${icon("chevRight", 14)}`;

  $("#creditValue").textContent = fmtCredits(u.credits);
  const base = plan.id === "prem" ? 1100 : plan.id === "pro" ? 500 : 25;
  $("#creditBar").style.width = Math.max(2, Math.min(100, (u.credits / base) * 100)) + "%";
  $("#creditCard").classList.toggle("low", u.credits < base * 0.1);
  $("#creditCard").title = `≈ ${fmtTokens(plan.tokensLeft || 0)} токенов на экономной модели`;
  $("#skillsCount").textContent = state.skills.length || "";
}

export function renderChats() {
  const box = $("#chatList");
  const prevScroll = box.scrollTop;
  box.innerHTML = "";
  const chats = [...state.chats].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);

  if (!chats.length) {
    box.appendChild(h(`<div class="side-empty">Здесь появятся ваши чаты</div>`));
    return;
  }

  let group = null;
  for (const c of chats) {
    const g = c.pinned ? "Закреплённые" : dateGroup(c.updatedAt);
    if (g !== group) {
      group = g;
      box.appendChild(h(`<div class="side-group"><div class="side-label">${esc(g)}</div></div>`));
    }
    box.lastElementChild.appendChild(chatRow(c));
  }
  box.scrollTop = prevScroll;
}

function chatRow(c) {
  const live = isStreaming(c.id);
  const el = h(`<div class="chat-item${c.id === state.currentId ? " active" : ""}" tabindex="0" role="button" title="${esc(c.title)}">
    ${c.pinned ? `<span class="muted">${icon("pin", 13, 1.9)}</span>` : ""}
    <span class="title">${esc(c.title)}</span>
    ${live ? `<span class="live"></span>` : `<button class="icon-btn" tabindex="-1" aria-label="Действия">${icon("dots", 15)}</button>`}
  </div>`);
  el.onclick = e => {
    if (e.target.closest("button")) return;
    bus.emit("openChat", c.id);
    if (isMobile()) $("#app").classList.remove("sidebar-open");
  };
  el.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
    if (e.key === "Delete") { e.preventDefault(); deleteChat(c); }
  };
  el.querySelector("button")?.addEventListener("click", e => {
    e.stopPropagation();
    chatMenu(e.currentTarget, c, () => startRename(el, c));
  });
  return el;
}

export function chatMenu(anchor, c, renameInline) {
  openMenu(anchor, [
    { label: "Переименовать", icon: "rename", onClick: () => renameInline ? renameInline() : renameDialog(c) },
    { label: c.pinned ? "Открепить" : "Закрепить", icon: c.pinned ? "unpin" : "pin", onClick: () => togglePin(c) },
    { sep: true },
    { label: "Удалить", icon: "trash", danger: true, onClick: () => deleteChat(c) },
  ], { align: "end", width: 190 });
}

async function togglePin(c) {
  c.pinned = !c.pinned;
  renderChats();
  try { await api.patch(`/api/chats/${c.id}`, { pinned: c.pinned }); }
  catch (e) { c.pinned = !c.pinned; renderChats(); toast(e.message, { type: "error" }); }
}

export async function deleteChat(c) {
  if (isStreaming(c.id)) { toast("Дождитесь окончания ответа", { type: "info" }); return; }
  const ok = await confirmDialog({ title: "Удалить чат?", text: `«${c.title}» и все его сообщения будут удалены без возможности восстановления.`, ok: "Удалить", danger: true });
  if (!ok) return;
  try {
    await api.del(`/api/chats/${c.id}`);
    state.chats = state.chats.filter(x => x.id !== c.id);
    state.chatCache.delete(c.id);
    if (state.currentId === c.id) bus.emit("openChat", null);
    renderChats();
    toast("Чат удалён");
  } catch (e) { toast(e.message, { type: "error" }); }
}

function startRename(row, c) {
  const titleEl = row.querySelector(".title");
  const input = h(`<input value="${esc(c.title)}" maxlength="120">`);
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== c.title) {
      c.title = value;
      const full = state.chatCache.get(c.id);
      if (full) full.title = value;
      try { await api.patch(`/api/chats/${c.id}`, { title: value }); } catch (e) { toast(e.message, { type: "error" }); }
      bus.emit("chatRenamed", c);
    }
    renderChats();
  };
  input.onblur = () => finish(true);
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
}

export async function renameDialog(c) {
  const { openModal } = await import("../ui.js");
  const body = h(`<div class="field"><label for="rnm">Название чата</label><input class="input" id="rnm" maxlength="120" value="${esc(c.title)}" autofocus></div>`);
  const foot = h(`<div style="display:contents"><button class="btn btn-ghost">Отмена</button><button class="btn btn-primary">Сохранить</button></div>`);
  const m = openModal({ title: "Переименовать чат", body, footer: foot });
  const input = body.querySelector("input");
  const save = async () => {
    const v = input.value.trim();
    m.close();
    if (!v || v === c.title) return;
    c.title = v;
    const full = state.chatCache.get(c.id);
    if (full) full.title = v;
    renderChats();
    bus.emit("chatRenamed", c);
    try { await api.patch(`/api/chats/${c.id}`, { title: v }); } catch (e) { toast(e.message, { type: "error" }); }
  };
  foot.children[0].onclick = () => m.close();
  foot.children[1].onclick = save;
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); save(); } };
}
