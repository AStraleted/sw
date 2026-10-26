/* Markdown → безопасный HTML.
   Весь текст экранируется; ссылки — только http(s) и mailto. Поддержка:
   заголовки, абзацы, списки (вложенные, задачи), цитаты, таблицы, разделители,
   блоки кода (в т.ч. незакрытые во время печати), жирный, курсив, зачёркнутый, код, ссылки. */
import { esc } from "./utils.js";
import { highlight, extFor, isPreviewable } from "./highlight.js";
import { icon } from "./icons.js";

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// ---------- строчные элементы ----------
function safeUrl(url) {
  const u = url.trim().replace(/^<|>$/g, "");
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

export function inline(text) {
  const slots = [];
  const keep = html => `\u0000${slots.push(html) - 1}\u0000`;

  // код в строке — первым, внутри него ничего не разбираем
  let s = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code>${esc(code.trim() ? code.replace(/^ (.*) $/, "$1") : code)}</code>`));
  // ссылки и картинки [текст](url)
  s = s.replace(/!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) => {
    const u = safeUrl(url);
    if (!u) return keep(esc(m));
    return keep(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${inlineNoLinks(label || u)}</a>`);
  });
  // голые ссылки
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»])/g, (m, pre, url) => pre + keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`));

  s = esc(s);
  s = inlineFormat(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
}

function inlineNoLinks(text) { return inlineFormat(esc(text)); }

function inlineFormat(s) {
  return s
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
}

// ---------- блоки ----------
function codeBlock(code, lang, index, open) {
  const label = lang || "текст";
  const lines = code.split("\n").length;
  const ext = extFor(lang);
  const collapsible = !open && lines > 40;
  return `<div class="code${collapsible ? " collapsed" : ""}" data-i="${index}">` +
    `<div class="code-head"><span class="code-lang">${esc(label)}</span>` +
    (isPreviewable(lang) ? `<button class="btn" data-act="preview" type="button">${icon("play", 14)}Предпросмотр</button>` : "") +
    `<button class="btn" data-act="copy" type="button">${icon("copy", 14)}<span>Копировать</span></button>` +
    `<button class="btn" data-act="download" data-ext="${esc(ext)}" type="button" title="Скачать .${esc(ext)}">${icon("download", 14)}</button>` +
    `</div><pre><code>${highlight(code, lang)}</code></pre>` +
    (collapsible ? `<div class="code-more"><button class="btn btn-sm btn-ghost" data-act="expand" type="button">Показать все ${lines} строк</button></div>` : "") +
    `</div>`;
}

function splitRow(line) {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
}

function table(lines) {
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(c => c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "");
  const al = i => aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
  let html = `<div class="table-wrap"><table><thead><tr>${head.map((c, i) => `<th${al(i)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>`;
  for (const row of lines.slice(2)) {
    const cells = splitRow(row);
    html += `<tr>${head.map((_, i) => `<td${al(i)}>${inline(cells[i] || "")}</td>`).join("")}</tr>`;
  }
  return html + `</tbody></table></div>`;
}

function list(lines, ctx) {
  // lines: строки списка; вложенность — по отступу
  const first = lines[0].match(LIST);
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const baseIndent = first[1].length;
  const items = [];
  for (const line of lines) {
    const m = line.match(LIST);
    if (m && m[1].length <= baseIndent + 1) items.push({ text: [m[3]] });
    else if (items.length) items[items.length - 1].text.push(line.replace(new RegExp(`^ {0,${baseIndent + 4}}`), ""));
  }
  const tag = ordered ? "ol" : "ul";
  const attrs = ordered && start !== 1 ? ` start="${start}"` : "";
  return `<${tag}${attrs}>` + items.map(it => {
    let body = it.text;
    let task = "";
    const tm = body[0].match(/^\[([ xX])\]\s+(.*)$/);
    if (tm) { task = `<input type="checkbox" disabled${tm[1] !== " " ? " checked" : ""}>`; body = [tm[2], ...body.slice(1)]; }
    const hasBlocks = body.length > 1;
    const inner = hasBlocks ? blocks(body, ctx, true) : inline(body[0]);
    return task ? `<li class="task">${task}<span>${inner}</span></li>` : `<li>${inner}</li>`;
  }).join("") + `</${tag}>`;
}

function blocks(lines, ctx, tight = false) {
  let html = "";
  let i = 0;
  const para = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join("\n");
    html += tight && !html ? inline(text).replace(/\n/g, "<br>") : `<p>${inline(text).replace(/\n/g, "<br>")}</p>`;
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // блок кода
    const f = line.match(FENCE);
    if (f) {
      flush();
      const fence = f[1];
      const lang = f[2] || "";
      const body = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(fence[0].repeat(fence.length)) && lines[i].trim().replace(new RegExp(`^${fence[0] === "`" ? "`" : "~"}+`), "").trim() === "") { closed = true; i++; break; }
        body.push(lines[i]);
        i++;
      }
      const index = ctx.codes.push({ code: body.join("\n"), lang }) - 1;
      html += codeBlock(body.join("\n"), lang, index, !closed && ctx.streaming);
      continue;
    }

    if (!line.trim()) { flush(); i++; continue; }

    const hd = line.match(HEADING);
    if (hd) { flush(); const lvl = hd[1].length; html += `<h${lvl}>${inline(hd[2])}</h${lvl}>`; i++; continue; }

    if (HR.test(line) && !para.length) { flush(); html += "<hr>"; i++; continue; }

    // таблица
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const rows = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(lines[i++]);
      html += table(rows);
      continue;
    }

    // цитата
    if (QUOTE.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && q.length && !FENCE.test(lines[i]) && !LIST.test(lines[i])))) {
        const m = lines[i].match(QUOTE);
        q.push(m ? m[1] : lines[i]);
        i++;
      }
      html += `<blockquote>${blocks(q, ctx)}</blockquote>`;
      continue;
    }

    // список
    if (LIST.test(line) && (!para.length || /^\s*([-*+]|1[.)])\s/.test(line))) {
      flush();
      const base = line.match(LIST)[1].length;
      const isOrd = s => /\d/.test(s.match(LIST)[2]);
      const ordered = isOrd(line);
      // пункт того же уровня, но другого типа (1. против -) начинает новый список
      const sameList = l => { const m = l.match(LIST); return m && (m[1].length > base || isOrd(l) === ordered); };
      const items = [line];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // пустая строка внутри списка допустима, если дальше продолжение
          const next = lines[i + 1];
          if (next !== undefined && ((LIST.test(next) && next.match(LIST)[1].length >= base && sameList(next)) || /^\s{2,}\S/.test(next))) { items.push(""); i++; continue; }
          break;
        }
        const m = l.match(LIST);
        if (m && m[1].length >= base) { if (!sameList(l)) break; items.push(l); i++; continue; }
        if (/^\s{2,}\S/.test(l) || (!m && !FENCE.test(l) && !HEADING.test(l) && !QUOTE.test(l) && items[items.length - 1] !== "")) {
          if (FENCE.test(l.trim())) {
            // блок кода внутри пункта списка
            items.push(l); i++;
            while (i < lines.length) { items.push(lines[i]); if (FENCE.test(lines[i].trim()) && lines[i].trim().length <= 4) { i++; break; } i++; }
            continue;
          }
          items.push(l); i++; continue;
        }
        break;
      }
      html += list(items.filter((l, k) => l !== "" || k < items.length - 1), ctx);
      continue;
    }

    para.push(line);
    i++;
  }
  flush();
  return html;
}

/** Возвращает { html, codes } — codes нужны для кнопок «Копировать» и «Скачать». */
export function renderMarkdown(src, { streaming = false } = {}) {
  const ctx = { codes: [], streaming };
  const html = blocks(String(src || "").replace(/\r\n?/g, "\n").split("\n"), ctx);
  return { html, codes: ctx.codes };
}
