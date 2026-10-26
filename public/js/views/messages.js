/* Отрисовка сообщений, стриминг ответа, действия над сообщениями */
import { state, bus, currentChat, modelById, isStreaming } from "../state.js";

import { $, esc, h, copyText, downloadText, fmtSize, fmtDuration, fmtNum, fileKind, greeting, reducedMotion } from "../utils.js";
import { icon } from "../icons.js";
import { mark } from "../logo.js";
import { renderMarkdown } from "../markdown.js";
import { toast, flashButton, openModal } from "../ui.js";
import { openPreview } from "./preview.js";

const QUICK = [
  { icon: "code", label: "Написать код", prompt: "Напиши код, который " },
  { icon: "pen", label: "Составить текст", prompt: "Составь текст: " },
  { icon: "bulb", label: "Объяснить", prompt: "Объясни простыми словами: " },
  { icon: "doc", label: "Разобрать файл", attach: true },
];

let scroller, messagesEl, pinned = true;

export function initMessages() {
  scroller = $("#scroller");
  messagesEl = $("#messages");

  scroller.addEventListener("scroll", () => {
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinned = gap < 80;
    $("#scrollDown").classList.toggle("show", gap > 220 && scroller.scrollHeight > scroller.clientHeight + 100);
    $("#topbar").classList.toggle("scrolled", scroller.scrollTop > 6);
  }, { passive: true });
  $("#scrollDown").onclick = () => { pinned = true; scrollToEnd(true); };

  messagesEl.addEventListener("click", onMessageClick);
  bus.on("renderChat", renderChat);
}

function scrollToEnd(smooth = false) {
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
}

function keepPinned() { if (pinned) scroller.scrollTop = scroller.scrollHeight; }

// ======================= экран чата =======================
export function renderChat() {
  const chat = currentChat();
  const empty = !chat || !chat.messages.length;
  $("#chatArea").classList.toggle("is-empty", empty);
  messagesEl.innerHTML = "";
  renderHero(empty);
  if (empty) { $("#scrollDown").classList.remove("show"); return; }

  const msgs = chat.messages;
  for (let i = 0; i < msgs.length; i++) {
    const el = buildMessage(msgs[i], chat, i === msgs.length - 1);
    el.classList.add("no-anim");
    messagesEl.appendChild(el);
  }
  pinned = true;
  requestAnimationFrame(() => scrollToEnd());

  // если ответ ещё идёт — продолжаем показывать его вживую
  const live = state.streams.get(chat.id);
  if (live) {
    const el = messagesEl.lastElementChild;
    live.el = el;
    updateAssistant(live, true);
  }
}

function renderHero(show) {
  const hero = $("#hero");
  hero.classList.toggle("hidden", !show);
  if (!show) return;
  const text = greeting(state.user?.name?.split(" ")[0]);
  const words = text.split(" ").map((w, i) => `<span class="w" style="animation-delay:${0.08 + i * 0.07}s">${esc(w)}</span>`).join(" ");
  hero.innerHTML = `<div class="hero-mark">${mark(34, "idle")}</div><h1 class="hero-title">${words}</h1><p class="hero-sub">Чем займёмся сегодня?</p>`;

  const qa = $("#quickActions");
  qa.innerHTML = "";
  QUICK.forEach((q, i) => {
    const b = h(`<button class="quick" type="button" style="animation-delay:${0.5 + i * 0.05}s">${icon(q.icon, 16)}${esc(q.label)}</button>`);
    b.onclick = () => {
      if (q.attach) { $("#fileInput").click(); return; }
      const input = $("#input");
      input.value = q.prompt;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new Event("input"));
    };
    qa.appendChild(b);
  });
}

// ======================= сообщение =======================
function buildMessage(m, chat, isLast) {
  return m.role === "user" ? buildUser(m, chat, isLast) : buildAssistant(m, chat, isLast);
}

function attachmentHtml(a) {
  const k = fileKind(a.name, a.type);
  if (a.type?.startsWith("image/")) return `<img class="att-img" src="/api/uploads/${a.id}" alt="${esc(a.name)}" data-img="${a.id}" loading="lazy">`;
  return `<a class="att" href="/api/uploads/${a.id}" download="${esc(a.name)}" title="Скачать ${esc(a.name)}">
    <span class="ext ${k.cls}">${esc(k.label)}</span>
    <span class="nm"><b>${esc(a.name)}</b><span>${fmtSize(a.size)}</span></span></a>`;
}

function buildUser(m, chat, isLast) {
  const el = h(`<div class="msg msg-user${isLast ? " last" : ""}" data-id="${m.id}"></div>`);
  if (m.attachments?.length) el.appendChild(h(`<div class="msg-attachments">${m.attachments.map(attachmentHtml).join("")}</div>`));
  if (m.content) el.appendChild(h(`<div class="bubble">${esc(m.content)}</div>`));
  el.appendChild(h(`<div class="msg-actions">
    <button class="icon-btn" data-act="copy-msg" title="Копировать">${icon("copy", 15)}</button>
    <button class="icon-btn" data-act="edit-msg" title="Изменить и отправить заново">${icon("edit", 15)}</button>
  </div>`));
  return el;
}

function buildAssistant(m, chat, isLast) {
  const model = modelById(m.model);
  const el = h(`<div class="msg msg-assistant${isLast ? " last" : ""}" data-id="${m.id}"></div>`);

  const head = h(`<div class="head"></div>`);
  if (m.reasoning) {
    head.appendChild(h(`<button class="think-btn" data-act="toggle-think" aria-expanded="false" type="button">
      ${icon("chevRight", 14, 2)}<span>Рассуждения</span>${m.thinkingMs ? `<span class="model-tag">· ${fmtDuration(m.thinkingMs)}</span>` : ""}</button>`));
    head.firstElementChild.firstElementChild?.classList.add("chev");
    head.querySelector("svg")?.classList.add("chev");
  }
  if (head.children.length) el.appendChild(head);

  if (m.reasoning) {
    el.appendChild(h(`<div class="reasoning"><div><div class="reasoning-inner">${esc(m.reasoning)}</div></div></div>`));
  }

  const answer = h(`<div class="answer md"></div>`);
  const { html, codes } = renderMarkdown(m.content || "");
  answer.innerHTML = html;
  answer._codes = codes;
  el.appendChild(answer);

  if (m.error) el.appendChild(h(`<div class="msg-error">${icon("alert", 16)}<span>${esc(m.error)}</span></div>`));
  if (m.stopped) el.appendChild(h(`<div class="msg-note">${icon("stop", 13)}Ответ остановлен</div>`));
  if (m.truncated) el.appendChild(h(`<div class="msg-note">${icon("alert", 13)}Ответ достиг предела длины. Попросите продолжить</div>`));

  const actions = h(`<div class="msg-actions">
    <button class="icon-btn" data-act="copy-msg" title="Копировать ответ">${icon("copy", 15)}</button>
    ${isLast ? `<button class="icon-btn" data-act="retry" title="Сгенерировать заново">${icon("retry", 15)}</button>` : ""}
    ${m.auto ? `<span class="auto-tag" title="Модель выбрана автоматически: ${esc(m.auto.reason)}">${icon("sparkle", 12)}Авто</span>` : ""}
    <span class="msg-meta">${esc(model?.name || m.model || "")}${m.usage ? ` · ${fmtNum(m.usage.output)} ток.` : ""}${m.cost ? ` · ${m.cost} кр.` : ""}</span>
  </div>`);
  el.appendChild(actions);
  return el;
}

// ======================= действия =======================
async function onMessageClick(e) {
  const btn = e.target.closest("button[data-act], [data-img]");
  if (!btn) return;
  const msgEl = btn.closest(".msg");
  const chat = currentChat();
  const m = chat?.messages.find(x => x.id === msgEl?.dataset.id);

  if (btn.dataset.img) { openImage(btn.src, btn.alt); return; }
  const act = btn.dataset.act;

  if (act === "toggle-think") {
    const box = msgEl.querySelector(".reasoning");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    box.classList.toggle("open", !open);
    return;
  }
  if (act === "copy-msg") { await copyText(m?.content || ""); flashButton(btn); toast("Скопировано"); return; }
  if (act === "edit-msg") { startEdit(msgEl, m); return; }
  if (act === "retry") { bus.emit("regenerate"); return; }

  // кнопки блока кода
  const codeBox = btn.closest(".code");
  if (!codeBox) return;
  const answer = codeBox.closest(".answer");
  const entry = answer?._codes?.[+codeBox.dataset.i];
  const code = entry?.code ?? codeBox.querySelector("pre")?.innerText ?? "";
  if (act === "copy") { await copyText(code); flashButton(btn); }
  else if (act === "download") downloadText(code, `squled.${btn.dataset.ext}`);
  else if (act === "preview") openPreview(code, entry?.lang);
  else if (act === "expand") { codeBox.classList.remove("collapsed"); btn.closest(".code-more").remove(); }
}

function startEdit(msgEl, m) {
  if (isStreaming()) { toast("Дождитесь окончания ответа", { type: "info" }); return; }
  const box = h(`<div class="edit-box"><textarea></textarea><div class="row">
    <button class="btn btn-ghost btn-sm" data-cancel>Отмена</button>
    <button class="btn btn-primary btn-sm" data-save>Отправить</button></div></div>`);
  const ta = box.querySelector("textarea");
  ta.value = m.content;
  const original = [...msgEl.children];
  msgEl.innerHTML = "";
  msgEl.appendChild(box);
  const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", fit);
  fit();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const cancel = () => { msgEl.innerHTML = ""; original.forEach(c => msgEl.appendChild(c)); };
  box.querySelector("[data-cancel]").onclick = cancel;
  box.querySelector("[data-save]").onclick = () => {
    const text = ta.value.trim();
    if (!text) return;
    bus.emit("editMessage", { messageId: m.id, text });
  };
  ta.onkeydown = e => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); box.querySelector("[data-save]").click(); }
  };
}

function openImage(src, alt) {
  openModal({ className: "lightbox", head: false, body: h(`<img src="${esc(src)}" alt="${esc(alt || "")}">`) });
}

// ======================= приём потока =======================
/** Начинает отрисовку нового ответа. Возвращает объект потока. */
export function beginStream(chat, userMessage, assistantMessage) {
  $("#chatArea").classList.remove("is-empty");
  $("#hero").classList.add("hidden");
  if (userMessage && !messagesEl.querySelector(`[data-id="${userMessage.id}"]`)) {
    messagesEl.querySelectorAll(".msg.last").forEach(e => e.classList.remove("last"));
    messagesEl.appendChild(buildMessage(userMessage, chat, false));
  }
  const el = h(`<div class="msg msg-assistant last" data-id="${assistantMessage.id}">
    <div class="head"><button class="think-btn" data-act="toggle-think" aria-expanded="false" type="button" disabled>
      ${icon("chevRight", 14, 2).replace("<svg", '<svg class="chev"')}<span class="shimmer">Думаю…</span></button></div>
    <div class="reasoning live"><div><div class="reasoning-inner"></div></div></div>
    <div class="answer md"></div>
  </div>`);
  messagesEl.appendChild(el);
  pinned = true;
  scrollToEnd();

  return {
    el,
    message: assistantMessage,
    thinking: "",
    content: "",
    thinkStarted: 0,
    rafQueued: false,
    lastRender: 0,
  };
}

export function streamEvent(stream, evt) {
  const m = stream.message;
  if (evt.type === "thinking_start") {
    stream.thinkStarted = Date.now();
    const btn = stream.el.querySelector(".think-btn");
    btn.disabled = false;
    btn.querySelector("span").textContent = "Рассуждаю…";
    stream.el.querySelector(".reasoning").classList.add("open");
  } else if (evt.type === "thinking") {
    stream.thinking += evt.text;
    m.reasoning = stream.thinking;
  } else if (evt.type === "text") {
    if (!stream.content) finishThinking(stream);
    stream.content += evt.text;
    m.content = stream.content;
  } else if (evt.type === "error") {
    m.error = evt.message;
  }
  scheduleUpdate(stream);
}

function finishThinking(stream) {
  const btn = stream.el.querySelector(".think-btn");
  const box = stream.el.querySelector(".reasoning");
  box.classList.remove("live");
  if (!stream.thinking) { btn.closest(".head").remove(); box.remove(); return; }
  box.classList.remove("open");
  const ms = stream.thinkStarted ? Date.now() - stream.thinkStarted : 0;
  stream.message.thinkingMs = ms;
  btn.querySelector("span").classList.remove("shimmer");
  btn.querySelector("span").textContent = "Рассуждения";
  if (ms) btn.insertAdjacentHTML("beforeend", `<span class="model-tag">· ${fmtDuration(ms)}</span>`);
}

function scheduleUpdate(stream) {
  if (stream.rafQueued) return;
  stream.rafQueued = true;
  requestAnimationFrame(() => {
    stream.rafQueued = false;
    // перерисовываем Markdown не чаще ~12 раз в секунду, чтобы не грузить браузер
    const now = performance.now();
    const full = now - stream.lastRender > 80;
    if (full) stream.lastRender = now;
    updateAssistant(stream, full);
  });
}

function updateAssistant(stream, full) {
  const { el } = stream;
  const reasoning = el.querySelector(".reasoning-inner");
  if (reasoning && stream.thinking !== undefined) {
    reasoning.textContent = stream.thinking;
    if (el.querySelector(".reasoning").classList.contains("live")) reasoning.scrollTop = reasoning.scrollHeight;
  }
  const answer = el.querySelector(".answer");
  if (answer && full) {
    const { html, codes } = renderMarkdown(stream.content, { streaming: true });
    answer.innerHTML = html;
    answer.classList.toggle("typing", !!stream.content);
    answer._codes = codes;
  }
  keepPinned();
}

/** Завершает отрисовку: подставляет итоговое сообщение с кнопками. */
export function endStream(stream, finalMessage, chat) {
  finishThinking(stream);
  const el = buildMessage(finalMessage, chat, true);
  el.classList.add("no-anim");
  stream.el.replaceWith(el);
  keepPinned();
}

export { scrollToEnd };
