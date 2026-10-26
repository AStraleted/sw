/* Предпросмотр HTML из ответа модели в изолированном окне */
import { h, copyText, downloadText } from "../utils.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { openModal, toast, flashButton } from "../ui.js";

export async function openPreview(code, lang = "html") {
  const isSvg = /^svg$/i.test(lang) || /^\s*<svg[\s>]/i.test(code);
  // Страницу собирает сервер: он же проверяет тариф и отдаёт её по одноразовой ссылке
  let previewId;
  try { ({ id: previewId } = await api.post("/api/preview", { code, lang })); }
  catch (e) {
    if (e.status === 402) { const { openPlans } = await import("./plans.js"); toast(e.message, { type: "error" }); openPlans("prem"); }
    else toast(e.message, { type: "error" });
    return;
  }
  const html = isSvg
    ? `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:92vw;max-height:92vh}</style>${code}`
    : /<html[\s>]/i.test(code) ? code : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${code}</body></html>`;

  const head = h(`<div style="display:contents">
    <h3>Предпросмотр</h3>
    <div class="seg">
      <button data-v="desktop" class="on">${icon("desktop", 14)}<span class="desktop-only">Экран</span></button>
      <button data-v="mobile">${icon("phone", 14)}<span class="desktop-only">Телефон</span></button>
    </div>
    <button class="btn btn-sm btn-ghost" data-a="copy">${icon("copy", 14)}<span class="desktop-only">Копировать</span></button>
    <button class="btn btn-sm btn-ghost" data-a="download">${icon("download", 14)}<span class="desktop-only">Скачать</span></button>
    <button class="btn btn-sm btn-ghost" data-a="newtab" title="Открыть в новой вкладке">${icon("external", 14)}</button>
    <button class="icon-btn" data-a="close" aria-label="Закрыть">${icon("close")}</button>
  </div>`);

  const stage = h(`<div class="preview-stage"><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups" src="/api/preview/${previewId}" title="Предпросмотр"></iframe></div>`);
  const m = openModal({ className: "preview-modal", head: false, body: stage });
  m.modal.prepend(h(`<div class="modal-head"></div>`));
  m.modal.firstElementChild.append(...head.children);
  m.body.style.padding = "0";
  m.body.style.display = "flex";
  m.body.style.flex = "1";
  m.body.style.minHeight = "0";

  m.modal.addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.v) {
      stage.classList.toggle("mobile", b.dataset.v === "mobile");
      m.modal.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
      return;
    }
    const a = b.dataset.a;
    if (a === "close") m.close();
    else if (a === "copy") { await copyText(code); flashButton(b, "Готово"); }
    else if (a === "download") downloadText(html, isSvg ? "preview.svg" : "preview.html", isSvg ? "image/svg+xml" : "text/html;charset=utf-8");
    else if (a === "newtab") {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const w = open(url, "_blank", "noopener");
      if (!w) toast("Браузер заблокировал новое окно", { type: "error" });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  });
}
