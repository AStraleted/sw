/* Поле ввода: автовысота, вложения, выбор модели и силы, отправка и остановка */
import { state, bus, currentChat, modelById, effortById, activeModel, activeEffort, isStreaming, can, planFeatures, AUTO_MODEL } from "../state.js";
import { api } from "../api.js";
import { $, esc, h, fmtSize, fileKind, plural, storage } from "../utils.js";
import { icon } from "../icons.js";
import { openMenu, toast } from "../ui.js";

const EFFORT_LEVEL = { low: 1, medium: 2, high: 3 };
export const pending = []; // { id, name, type, size, uploading, progress, error, preview, abort }

let input, sendBtn;

export function initComposer(actions) {
  input = $("#input");
  sendBtn = $("#sendBtn");
  $("#attachBtn").innerHTML = icon("clip");
  renderSendButton();

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("paste", onPaste);

  sendBtn.onclick = () => isStreaming() ? actions.stop() : actions.send();
  $("#attachBtn").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };

  $("#modelBtn").onclick = e => modelMenu(e.currentTarget);
  $("#effortBtn").onclick = e => effortMenu(e.currentTarget);
  $("#skillsChip").onclick = () => actions.openSettings("skills");

  initDragDrop();
  bus.on("composer", renderComposer);
  renderComposer();
}

function onInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 280) + "px";
  renderSendButton();
}

function onKeyDown(e) {
  const sendOnEnter = state.user?.settings?.sendOnEnter !== false;
  const enter = e.key === "Enter";
  if (enter && (sendOnEnter ? !e.shiftKey : (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    if (!isStreaming()) bus.emit("send");
  }
  if (e.key === "ArrowUp" && !input.value && !isStreaming()) {
    // быстрый возврат к последнему своему сообщению
    const chat = currentChat();
    const last = [...(chat?.messages || [])].reverse().find(m => m.role === "user");
    if (last) { e.preventDefault(); input.value = last.content; onInput(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
}

export function focusInput() { if (!matchMedia("(max-width: 860px)").matches) input?.focus(); }
export function getText() { return input.value.trim(); }
export function clearInput() { input.value = ""; input.style.height = "auto"; renderSendButton(); }
export function setText(v) { input.value = v; onInput(); input.focus(); }

function renderSendButton() {
  const streaming = isStreaming();
  sendBtn.classList.toggle("stop", streaming);
  sendBtn.innerHTML = icon(streaming ? "stop" : "arrowUp", 18, 2.1);
  sendBtn.setAttribute("aria-label", streaming ? "Остановить" : "Отправить");
  sendBtn.disabled = !streaming && !input.value.trim() && !pending.some(f => !f.error);
  $("#attachBtn").disabled = streaming;
}

export function renderComposer() {
  const modelId = activeModel();
  const model = modelById(modelId);
  const isAuto = modelId === "auto";
  const effort = effortById(activeEffort());
  $("#modelBtn").innerHTML = (isAuto ? icon("sparkle", 15) : "") +
    `<span class="model-label">${esc(isAuto ? "Авто" : model?.name.replace("Claude ", "") || "Модель")}</span>` +
    icon("chevDown", 14, 2).replace("<svg", '<svg class="chev"');
  $("#modelBtn").classList.toggle("accent", isAuto);
  $("#modelBtn").title = isAuto
    ? "Авто: модель подбирается под задачу, чтобы не тратить лишние кредиты"
    : `Модель: ${model?.name || ""} · списание ×${model?.mult}`;
  $("#effortBtn").innerHTML = `<span class="effort-bars l${EFFORT_LEVEL[effort?.id] || 2}"><i></i><i></i><i></i></span><span class="desktop-only">${esc(effort?.label || "")}</span>`;
  $("#effortBtn").title = `Сила рассуждений: ${effort?.label} — ${effort?.hint}`;

  const on = can("skills") ? state.skills.filter(s => s.enabled).length : 0;
  const chip = $("#skillsChip");
  chip.classList.toggle("hidden", !on);
  if (on) chip.innerHTML = `${icon("puzzle", 15)}${on} ${plural(on, "скилл", "скилла", "скиллов")}`;

  // Прикрепление файлов — по тарифу
  $("#attachBtn").classList.toggle("hidden", !can("files"));

  renderNotice();
  renderSendButton();
}

function renderNotice() {
  const box = $("#notice");
  const shell = $("#composerShell");
  const plan = state.user?.plan;
  let html = "";
  if (state.user && state.user.credits <= 0) {
    html = `<div class="notice warn">${icon("alert", 15)}<span><b>Кредиты закончились.</b> Пополните баланс, чтобы продолжить.</span><span class="spacer"></span><button class="btn btn-sm btn-primary" id="noticePlans">Тарифы</button></div>`;
  } else if (plan?.expiring) {
    html = `<div class="notice">${icon("alert", 15)}<span>Тариф ${esc(plan.name)} заканчивается через ${plan.daysLeft} ${plural(plan.daysLeft, "день", "дня", "дней")}</span><span class="spacer"></span><button class="btn btn-sm btn-outline" id="noticePlans">Продлить</button></div>`;
  } else if (state.config.mock && !storage.get("mockNoticeHidden", false)) {
    html = `<div class="notice">${icon("info", 15)}<span><b>Демо-режим.</b> Ответы генерируются локально: добавьте API_TOKEN в .env</span><span class="spacer"></span><button class="icon-btn sm" id="hideNotice" aria-label="Скрыть">${icon("close", 14)}</button></div>`;
  } else if (state.user && state.user.credits < 10) {
    html = `<div class="notice">${icon("coins", 15)}<span>Осталось мало кредитов: ${state.user.credits}</span></div>`;
  }
  box.innerHTML = html;
  shell.classList.toggle("has-notice", !!html);
  $("#hideNotice")?.addEventListener("click", () => { storage.set("mockNoticeHidden", true); renderNotice(); });
  $("#noticePlans")?.addEventListener("click", openPlansFromComposer);
}

// ======================= меню модели и силы =======================
function modelMenu(anchor) {
  const current = activeModel();
  const items = [{
    label: "Авто", hint: "Подбирает модель под задачу и экономит кредиты",
    checked: current === "auto", icon: "sparkle",
    onClick: () => setModel("auto"),
  }, { sep: true }];

  let family = null;
  for (const m of state.models) {
    if (m.family !== family) { family = m.family; items.push({ heading: family }); }
    items.push({
      label: m.name + (m.locked ? " · закрыта" : ""),
      hint: m.locked ? "Доступна на старшем тарифе" : m.note,
      checked: m.id === current,
      right: m.locked ? "" : `×${m.mult}`,
      icon: m.locked ? "key" : undefined,
      onClick: () => m.locked ? openPlansFromComposer() : setModel(m.id),
    });
  }
  openMenu(anchor, items, { align: "end", placement: "top", width: 288 });
}

async function openPlansFromComposer() {
  const { openPlans } = await import("./plans.js");
  openPlans();
}

function effortMenu(anchor) {
  const current = activeEffort();
  openMenu(anchor, state.efforts.map(e => ({
    label: e.label, hint: e.hint, checked: e.id === current,
    html: `<span class="effort-bars l${EFFORT_LEVEL[e.id]}" style="margin-right:2px"><i></i><i></i><i></i></span><span class="mi-body">${esc(e.label)}<span class="mi-hint">${esc(e.hint)}</span></span>`,
    onClick: () => setEffort(e.id),
  })), { align: "end", placement: "top", width: 268 });
}

async function setModel(id) {
  const chat = currentChat();
  if (chat) { chat.model = id; const s = state.chats.find(c => c.id === chat.id); if (s) s.model = id; }
  else state.draft.model = id;
  renderComposer();
  if (chat) { try { await api.patch(`/api/chats/${chat.id}`, { model: id }); } catch {} }
}

async function setEffort(id) {
  const chat = currentChat();
  if (chat) { chat.effort = id; const s = state.chats.find(c => c.id === chat.id); if (s) s.effort = id; }
  else state.draft.effort = id;
  renderComposer();
  if (chat) { try { await api.patch(`/api/chats/${chat.id}`, { effort: id }); } catch {} }
}

// ======================= файлы =======================
// Модели принимают изображения ограниченного размера, а слишком большой запрос
// сервис просто отклоняет. Поэтому картинки уменьшаем прямо в браузере.
const MAX_IMAGE_SIDE = 1568;
const IMAGE_QUALITY = 0.85;

async function prepareImage(file) {
  // GIF не трогаем: он может быть анимированным
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const needsResize = scale < 1;
    const needsConvert = !["image/jpeg", "image/png", "image/webp"].includes(file.type);
    // Маленькое и в подходящем формате — оставляем как есть
    if (!needsResize && !needsConvert && file.size < 1.6 * 1048576) { bitmap.close?.(); return file; }

    const w = Math.round(bitmap.width * scale), hgt = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    // Прозрачность на белом: иначе в JPEG она станет чёрной
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(bitmap, 0, 0, w, hgt);
    bitmap.close?.();

    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", IMAGE_QUALITY));
    if (!blob || blob.size >= file.size && !needsConvert) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file; // не удалось обработать — отправим оригинал
  }
}

export async function addFiles(files) {
  if (!can("files")) { toast("Файлы недоступны на вашем тарифе", { type: "error" }); return; }
  const maxMb = planFeatures().maxFileMb || state.config.maxFileMb || 10;

  for (const original of files) {
    if (pending.length >= 10) { toast("Не больше 10 файлов за раз", { type: "error" }); break; }
    const isImage = (original.type || "").startsWith("image/");

    const entry = {
      name: original.name, type: original.type || "application/octet-stream",
      size: original.size, uploading: true, progress: 0,
    };
    if (isImage) entry.preview = URL.createObjectURL(original);
    pending.push(entry);
    renderFiles();

    // Картинку сначала уменьшаем, иначе запрос к модели может не пройти
    let file = original;
    if (isImage) {
      file = await prepareImage(original);
      entry.type = file.type;
      entry.size = file.size;
      entry.name = file.name;
      renderFiles();
    }

    if (file.size > maxMb * 1048576) {
      entry.uploading = false;
      entry.error = `больше ${maxMb} МБ`;
      renderFiles();
      toast(`${original.name}: на вашем тарифе предел ${maxMb} МБ`, { type: "error" });
      continue;
    }

    const { promise, abort } = api.upload(file, p => { entry.progress = p; updateChip(entry); });
    entry.abort = abort;
    promise.then(f => { entry.id = f.id; entry.uploading = false; renderFiles(); })
      .catch(err => { entry.uploading = false; entry.error = err.message; renderFiles(); if (err.message !== "Загрузка отменена") toast(`${original.name}: ${err.message}`, { type: "error" }); });
  }
  renderFiles();
}

function updateChip(entry) {
  const bar = entry._el?.querySelector(".progress");
  if (bar) bar.style.width = Math.round(entry.progress * 100) + "%";
}

export function removeFile(entry) {
  const i = pending.indexOf(entry);
  if (i === -1) return;
  pending.splice(i, 1);
  if (entry.uploading) entry.abort?.();
  else if (entry.id) api.del(`/api/uploads/${entry.id}`).catch(() => {});
  if (entry.preview) URL.revokeObjectURL(entry.preview);
  renderFiles();
}

export function clearFiles() {
  for (const f of pending) if (f.preview) URL.revokeObjectURL(f.preview);
  pending.length = 0;
  renderFiles();
}

export function renderFiles() {
  const box = $("#fileChips");
  box.hidden = !pending.length;
  box.innerHTML = "";
  for (const f of pending) {
    const k = fileKind(f.name, f.type);
    const el = h(`<div class="file-chip${f.error ? " error" : ""}" title="${esc(f.name)}">
      ${f.preview ? `<img class="thumb" src="${f.preview}" alt="">` : `<span class="ext ${k.cls}" style="width:32px;height:32px;border-radius:7px;display:grid;place-items:center;font-size:9.5px;font-weight:700;text-transform:uppercase">${esc(k.label)}</span>`}
      <span class="nm"><b>${esc(f.name)}</b><span>${f.error ? esc(f.error) : f.uploading ? "Загрузка…" : fmtSize(f.size)}</span></span>
      <button class="icon-btn sm x" aria-label="Убрать">${icon("close", 14)}</button>
      ${f.uploading ? `<i class="progress" style="width:${Math.round(f.progress * 100)}%"></i>` : ""}
    </div>`);
    f._el = el;
    el.querySelector("button").onclick = () => removeFile(f);
    box.appendChild(el);
  }
  renderSendButton();
}

export const readyAttachmentIds = () => pending.filter(f => f.id && !f.error).map(f => f.id);
export const filesBusy = () => pending.some(f => f.uploading);

// ======================= перетаскивание ======================
function initDragDrop() {
  const overlay = $("#dropOverlay");
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.classList.add("show"); });
  addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; overlay.classList.remove("show"); } });
  addEventListener("drop", e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove("show");
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) { addFiles(files); focusInput(); }
  });
}
