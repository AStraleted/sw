/* Общие компоненты: всплывающие меню, модальные окна, подтверждения, уведомления */
import { esc, h } from "./utils.js";
import { icon } from "./icons.js";

// ======================= уведомления =======================
export function toast(message, { type = "ok", duration = 3200 } = {}) {
  let box = document.getElementById("toasts");
  if (!box) { box = h(`<div id="toasts" role="status" aria-live="polite"></div>`); document.body.appendChild(box); }
  const ico = type === "error" ? "alert" : type === "info" ? "info" : "check";
  const el = h(`<div class="toast ${type}">${icon(ico, 16, 2)}<span>${esc(message)}</span></div>`);
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, duration);
}

// ======================= меню =======================
let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  const { el, anchor, onClose, cleanup } = activeMenu;
  activeMenu = null;
  cleanup();
  anchor?.classList.remove("menu-open");
  anchor?.setAttribute("aria-expanded", "false");
  el.classList.add("closing");
  setTimeout(() => el.remove(), 120);
  onClose?.();
}

/**
 * items: [{ label, icon, hint, right, checked, danger, disabled, onClick }, { sep: true }, { heading: "..." }]
 * opts: { align: "start" | "end", placement: "bottom" | "top", width }
 */
export function openMenu(anchor, items, opts = {}) {
  if (activeMenu?.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = h(`<div class="menu" role="menu" tabindex="-1"></div>`);
  if (opts.width) el.style.minWidth = opts.width + "px";
  const buttons = [];
  for (const it of items) {
    if (it.sep) { el.appendChild(h(`<div class="menu-sep"></div>`)); continue; }
    if (it.heading) { el.appendChild(h(`<div class="menu-label">${esc(it.heading)}</div>`)); continue; }
    const hasCheck = items.some(x => "checked" in x);
    const b = h(`<button class="menu-item${it.danger ? " danger" : ""}" role="menuitem" type="button"${it.disabled ? " disabled" : ""}>
      ${hasCheck ? `<span class="mi-check">${it.checked ? icon("check", 16, 2.2) : ""}</span>` : ""}
      ${it.icon ? icon(it.icon, 16) : ""}
      ${it.html ? it.html : `<span class="mi-body">${esc(it.label)}${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ""}</span>`}
      ${it.right ? `<span class="mi-right">${esc(it.right)}</span>` : ""}
    </button>`);
    b.onclick = e => { e.stopPropagation(); closeMenu(); it.onClick?.(); };
    b.onmouseenter = () => focusItem(buttons.indexOf(b));
    buttons.push(b);
    el.appendChild(b);
  }
  document.body.appendChild(el);

  // позиционирование возле кнопки
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = opts.align === "end" ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6;
  const wantTop = opts.placement === "top" || top + mh > innerHeight - 8;
  if (wantTop && r.top - mh - 6 > 8) top = r.top - mh - 6;
  el.style.left = left + "px";
  el.style.top = Math.max(8, top) + "px";
  el.style.transformOrigin = `${opts.align === "end" ? "right" : "left"} ${top < r.top ? "bottom" : "top"}`;

  let focus = -1;
  function focusItem(i) {
    buttons[focus]?.classList.remove("focus");
    focus = (i + buttons.length) % buttons.length;
    buttons[focus]?.classList.add("focus");
    buttons[focus]?.focus({ preventScroll: true });
  }
  const checked = items.filter(x => !x.sep && !x.heading).findIndex(x => x.checked);

  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusItem(focus + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(focus - 1); }
    else if (e.key === "Tab") closeMenu();
  };
  const onDown = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onResize = () => closeMenu();
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  addEventListener("resize", onResize);
  const cleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
    removeEventListener("resize", onResize);
  };

  anchor.classList.add("menu-open");
  anchor.setAttribute("aria-expanded", "true");
  activeMenu = { el, anchor, onClose: opts.onClose, cleanup };
  if (opts.keyboard !== false) requestAnimationFrame(() => checked > -1 ? focusItem(checked) : el.focus({ preventScroll: true }));
  return el;
}

// ======================= модальные окна =======================
const modalStack = [];

export function openModal({ title = "", body = "", footer = "", className = "", onClose, closable = true, head = true } = {}) {
  const root = h(`<div class="modal-root" role="dialog" aria-modal="true">
    <div class="modal-backdrop"></div>
    <div class="modal ${className}">
      ${head ? `<div class="modal-head"><h3>${esc(title)}</h3>${closable ? `<button class="icon-btn" data-close aria-label="Закрыть">${icon("close")}</button>` : ""}</div>` : ""}
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-foot"></div>` : ""}
    </div>
  </div>`);
  const bodyEl = root.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const footEl = root.querySelector(".modal-foot");
  if (footEl) { if (typeof footer === "string") footEl.innerHTML = footer; else footEl.appendChild(footer); }

  const prevFocus = document.activeElement;
  let closed = false;
  const close = result => {
    if (closed) return;
    closed = true;
    const i = modalStack.indexOf(api);
    if (i > -1) modalStack.splice(i, 1);
    root.classList.add("closing");
    setTimeout(() => root.remove(), 160);
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.(result);
  };
  const api = { el: root, modal: root.querySelector(".modal"), body: bodyEl, foot: footEl, close, closable };

  root.querySelector(".modal-backdrop").onclick = () => closable && close();
  root.querySelector("[data-close]")?.addEventListener("click", () => close());
  document.body.appendChild(root);
  modalStack.push(api);
  requestAnimationFrame(() => {
    const f = root.querySelector("[autofocus], input:not([type=hidden]):not([disabled]), textarea, .btn-primary, .btn-danger, .btn-accent");
    f?.focus({ preventScroll: true });
  });
  return api;
}

export const hasModal = () => modalStack.length > 0;

document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || activeMenu || !modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (top.closable) { e.preventDefault(); e.stopPropagation(); top.close(); }
});

export function confirmDialog({ title, text = "", ok = "Подтвердить", danger = false }) {
  return new Promise(resolve => {
    const foot = h(`<div style="display:contents"><button class="btn btn-ghost" type="button">Отмена</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button">${esc(ok)}</button></div>`);
    let result = false;
    const m = openModal({ title, body: `<p style="margin:0">${esc(text)}</p>`, footer: foot, onClose: () => resolve(result) });
    const [cancel, okBtn] = foot.querySelectorAll("button");
    cancel.onclick = () => m.close();
    okBtn.onclick = () => { result = true; m.close(); };
    setTimeout(() => okBtn.focus(), 30);
  });
}

// Короткая анимация «Скопировано» на кнопке
export function flashButton(btn, text = "Скопировано") {
  const label = btn.querySelector("span");
  const prev = btn.innerHTML;
  btn.classList.add("done");
  if (label) btn.innerHTML = icon("check", 14, 2) + `<span>${esc(text)}</span>`;
  else btn.innerHTML = icon("check", btn.querySelector("svg")?.getAttribute("width") || 16, 2);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.innerHTML = prev; btn.classList.remove("done"); }, 1400);
}
