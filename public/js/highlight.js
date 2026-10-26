/* Лёгкая подсветка синтаксиса для популярных языков.
   Не полный парсер — но комментарии, строки, числа, ключевые слова и функции различает надёжно. */
import { esc } from "./utils.js";

const KW = {
  js: "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield",
  jsLit: "true false null undefined NaN Infinity",
  ts: "type interface enum implements private public protected readonly declare namespace abstract as keyof infer is satisfies",
  py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case",
  pyLit: "True False None self cls",
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool class namespace template typename public private protected virtual override new delete this using try catch throw nullptr true false std include define",
  java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while var record true false null",
  cs: "abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally float for foreach get if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sealed set short static string struct switch this throw true try typeof uint ulong using var virtual void while",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota",
  rs: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  php: "abstract and array as break case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include instanceof interface isset list match namespace new or print private protected public require return static switch throw trait try unset use var while yield true false null",
  rb: "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor",
  sh: "if then else elif fi for while in do done case esac function return local export echo exit set unset source cd sudo",
  sql: "select from where and or not insert into values update set delete create table drop alter add primary key foreign references join left right inner outer on as group by order having limit offset distinct union all null is in like between exists case when then else end index view default count sum avg min max asc desc",
  swift: "class struct enum protocol extension func var let if else guard switch case default for in while repeat return break continue import init self super true false nil throws try catch async await",
  kt: "fun val var class object interface if else when for while do return break continue import package true false null this super override open data sealed private public internal",
  lua: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
};

const LANGS = {
  js:   { kw: KW.js + " " + KW.jsLit, line: "//", block: true, tpl: true },
  ts:   { kw: KW.js + " " + KW.jsLit + " " + KW.ts, line: "//", block: true, tpl: true },
  py:   { kw: KW.py + " " + KW.pyLit, line: "#", triple: true },
  c:    { kw: KW.c, line: "//", block: true, pre: true },
  java: { kw: KW.java, line: "//", block: true },
  cs:   { kw: KW.cs, line: "//", block: true },
  go:   { kw: KW.go, line: "//", block: true, tpl: true },
  rs:   { kw: KW.rs, line: "//", block: true },
  php:  { kw: KW.php, line: "//", hash: true, block: true, vars: true },
  rb:   { kw: KW.rb, line: "#" },
  sh:   { kw: KW.sh, line: "#", vars: true },
  sql:  { kw: KW.sql, line: "--", block: true, ci: true },
  swift:{ kw: KW.swift, line: "//", block: true },
  kt:   { kw: KW.kt, line: "//", block: true },
  lua:  { kw: KW.lua, line: "--" },
  yaml: { kw: "true false null yes no", line: "#", yaml: true },
  json: { kw: "true false null", json: true },
};

const ALIAS = {
  javascript: "js", jsx: "js", mjs: "js", cjs: "js", node: "js", typescript: "ts", tsx: "ts",
  python: "py", py3: "py", cpp: "c", "c++": "c", h: "c", hpp: "c", cc: "c", csharp: "cs", "c#": "cs",
  golang: "go", rust: "rs", ruby: "rb", bash: "sh", shell: "sh", zsh: "sh", console: "sh", powershell: "sh", ps1: "sh",
  postgres: "sql", mysql: "sql", sqlite: "sql", yml: "yaml", kotlin: "kt", jsonc: "json", json5: "json",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html", css: "css", scss: "css", less: "css",
};

const span = (cls, s) => `<span class="tk-${cls}">${esc(s)}</span>`;

function buildRegex(spec) {
  const parts = [];
  if (spec.triple) parts.push(`(?<s3>"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$))`);
  const comments = [];
  if (spec.block) comments.push(`/\\*[\\s\\S]*?(?:\\*/|$)`);
  if (spec.line) comments.push(`${spec.line.replace(/[/]/g, "\\/")}[^\\n]*`);
  if (spec.hash) comments.push(`#[^\\n]*`);
  if (comments.length) parts.push(`(?<c>${comments.join("|")})`);
  parts.push(`(?<s>"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?${spec.tpl ? "|`(?:[^`\\\\]|\\\\.)*`?" : ""})`);
  if (spec.pre) parts.push(`(?<k2>^\\s*#\\s*\\w+)`);
  if (spec.vars) parts.push(`(?<v>\\$\\{?[A-Za-z_][\\w]*\\}?)`);
  parts.push(`(?<n>\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b)`);
  parts.push(`(?<w>[A-Za-z_$][\\w$]*)`);
  return new RegExp(parts.join("|"), "gm");
}

const cache = new Map();

function highlightGeneric(code, key) {
  const spec = LANGS[key];
  if (!cache.has(key)) cache.set(key, { re: buildRegex(spec), kw: new Set(spec.kw.split(" ").map(w => spec.ci ? w.toLowerCase() : w)) });
  const { re, kw } = cache.get(key);
  let out = "", last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(code))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    const g = m.groups;
    if (g.c !== undefined) out += span("c", g.c);
    else if (g.s3 !== undefined || g.s !== undefined) {
      const s = g.s3 ?? g.s;
      // В JSON и YAML ключ перед двоеточием подсвечиваем как свойство
      const isKey = (spec.json || spec.yaml) && /^\s*:/.test(code.slice(m.index + s.length));
      out += span(isKey ? "p" : "s", s);
    }
    else if (g.k2 !== undefined) out += span("k", g.k2);
    else if (g.v !== undefined) out += span("a", g.v);
    else if (g.n !== undefined) out += span("n", g.n);
    else if (g.w !== undefined) {
      const w = g.w;
      const after = code.slice(m.index + w.length, m.index + w.length + 2);
      if (kw.has(spec.ci ? w.toLowerCase() : w)) out += span("k", w);
      else if (spec.yaml && /^\s*:/.test(code.slice(m.index + w.length, m.index + w.length + 3)) && /(^|\n)\s*(-\s*)?$/.test(code.slice(0, m.index))) out += span("p", w);
      else if (/^\s*\(/.test(after)) out += span("f", w);
      else if (/^[A-Z][a-z0-9]/.test(w) && key !== "sql") out += span("b", w);
      else out += esc(w);
    }
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

function highlightHtml(code) {
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"?|'[^']*'?|[^\s>]+))?)*)\s*(\/?>)?|(<!DOCTYPE[^>]*>)/gi;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    let chunk = code.slice(last, m.index);
    out += esc(chunk);
    if (m[1]) out += span("c", m[1]);
    else if (m[6]) out += span("o", m[6]);
    else {
      out += span("o", m[2]) + span("t", m[3]);
      if (m[4]) out += m[4].split(/(\s+|=|"[^"]*"?|'[^']*'?)/).map(p => {
        if (!p) return "";
        if (/^\s+$/.test(p) || p === "=") return esc(p);
        if (/^["']/.test(p)) return span("s", p);
        return span("a", p);
      }).join("");
      if (m[5]) out += span("o", m[5]);
    }
    last = m.index + m[0].length;
    // Внутри <script> и <style> подсвечиваем как JS / CSS
    if (m[3] && !m[2].includes("/") && /^(script|style)$/i.test(m[3]) && m[5]) {
      const close = new RegExp(`</${m[3]}\\s*>`, "i");
      const rest = code.slice(last);
      const ci = rest.search(close);
      const inner = ci === -1 ? rest : rest.slice(0, ci);
      out += /script/i.test(m[3]) ? highlightGeneric(inner, "js") : highlightCss(inner);
      last += inner.length;
      re.lastIndex = last;
    }
  }
  return out + esc(code.slice(last));
}

function highlightCss(code) {
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(@[\w-]+)|(#[\da-fA-F]{3,8}\b)|(-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?\b)|([\w-]+)(?=\s*:(?!:)[^{;}]*[;}])|([.#]?[A-Za-z_][\w-]*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += span("c", m[1]);
    else if (m[2]) out += span("s", m[2]);
    else if (m[3]) out += span("k", m[3]);
    else if (m[4] || m[5]) out += span("n", m[0]);
    else if (m[6]) out += span("p", m[6]);
    else if (m[7]) out += /^[.#]/.test(m[7]) ? span("t", m[7]) : esc(m[7]);
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

export function highlight(code, lang) {
  const l = (lang || "").toLowerCase();
  const key = ALIAS[l] || l;
  try {
    if (key === "html") return highlightHtml(code);
    if (key === "css") return highlightCss(code);
    if (LANGS[key]) return highlightGeneric(code, key);
  } catch (e) { console.warn("highlight", e); }
  return esc(code);
}

// Расширение файла для скачивания
export function extFor(lang) {
  const l = (lang || "").toLowerCase().replace(/[^a-z0-9#+]/g, "");
  const map = { javascript: "js", node: "js", typescript: "ts", python: "py", py3: "py", markdown: "md", bash: "sh", shell: "sh", zsh: "sh", console: "sh",
    yml: "yaml", csharp: "cs", "c#": "cs", "c++": "cpp", golang: "go", rust: "rs", ruby: "rb", kotlin: "kt", text: "txt", plaintext: "txt", "": "txt", powershell: "ps1", htm: "html" };
  return map[l] ?? l;
}

export const isPreviewable = lang => /^(html?|svg)$/i.test(lang || "");
