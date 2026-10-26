/* Мелкие помощники */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
}

export function fmtCredits(n) {
  return (Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function fmtNum(n) { return Math.round(n).toLocaleString("ru-RU"); }

// Токены крупными единицами: 60 млн, 1,2 млрд
export function fmtTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млрд`;
  if (n >= 1e6) return `${Math.round(n / 1e6).toLocaleString("ru-RU")} млн`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("ru-RU")} тыс.`;
  return Math.round(n).toLocaleString("ru-RU");
}

export function fmtDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

export function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return withTime ? `сегодня, ${time}` : "сегодня";
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  return withTime ? `${date}, ${time}` : date;
}

// Группа для списка чатов
export function dateGroup(ts) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return "Сегодня";
  if (ts >= start - 86400000) return "Вчера";
  if (ts >= start - 7 * 86400000) return "Последние 7 дней";
  if (ts >= start - 30 * 86400000) return "Последние 30 дней";
  return "Ранее";
}

export function greeting(name) {
  const hr = new Date().getHours();
  const part = hr < 5 ? "Доброй ночи" : hr < 12 ? "Доброе утро" : hr < 18 ? "Добрый день" : "Добрый вечер";
  return name ? `${part}, ${name}` : part;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fileKind(name, type = "") {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (type.startsWith("image/")) return { cls: "img", label: ext.slice(0, 4) || "img" };
  if (type === "application/pdf" || ext === "pdf") return { cls: "pdf", label: "pdf" };
  if (/^(js|ts|jsx|tsx|py|html?|css|json|go|rs|java|c|cpp|cs|php|rb|sh|sql|xml|ya?ml|md)$/.test(ext)) return { cls: "code", label: ext.slice(0, 4) };
  return { cls: "", label: (ext || "file").slice(0, 4) };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function downloadText(text, filename, type = "text/plain;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const storage = {
  get(k, d) { try { const v = localStorage.getItem("sq_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sq_" + k, JSON.stringify(v)); } catch {} },
};

export const isMobile = () => matchMedia("(max-width: 860px)").matches;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
