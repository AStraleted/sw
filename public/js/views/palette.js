/* Поиск по чатам и быстрые команды (Ctrl+K) */
import { state, bus } from "../state.js";
import { api } from "../api.js";
import { esc, h, debounce, fmtDate, isMobile } from "../utils.js";
import { icon } from "../icons.js";
import { openModal } from "../ui.js";

export function openPalette(actions, initial = "") {
  const body = h(`<div style="display:contents">
    <div class="palette-input">${icon("search", 18)}<input placeholder="Поиск по чатам или команда…" aria-label="Поиск" spellcheck="false"></div>
    <div class="palette-list" role="listbox"></div>
    <div class="palette-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span>
    </div>
  </div>`);
  const m = openModal({ className: "palette", head: false, body });
  m.body.style.padding = "0";
  m.body.style.display = "flex";
  m.body.style.flexDirection = "column";
  m.body.style.minHeight = "0";

  const input = body.querySelector("input");
  const list = body.querySelector(".palette-list");
  let items = [], focus = 0;

  const commands = () => [
    { kind: "cmd", title: "Новый чат", sub: "Ctrl+Shift+O", ico: "compose", run: () => actions.newChat() },
    { kind: "cmd", title: "Скиллы", sub: "Подключить инструкции из GitHub", ico: "puzzle", run: () => actions.openSettings("skills") },
    { kind: "cmd", title: "Использование и кредиты", ico: "chart", run: () => actions.openSettings("usage") },
    { kind: "cmd", title: "Настройки", sub: "Профиль, модель по умолчанию, инструкции", ico: "settings", run: () => actions.openSettings("profile") },
    ...(state.user?.role === "admin" ? [{ kind: "cmd", title: "Администрирование", sub: "Пользователи и кредиты", ico: "shield", run: () => actions.openSettings("admin") }] : []),
    { kind: "cmd", title: "Горячие клавиши", ico: "keyboard", run: () => actions.openShortcuts() },
    { kind: "cmd", title: "Выйти из аккаунта", ico: "logout", run: () => actions.logout() },
  ];

  function highlightText(text, q) {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return esc(text);
    return esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` + esc(text.slice(i + q.length));
  }

  function render(q = "") {
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(h(`<div class="side-empty" style="padding:30px">${q ? "Ничего не найдено" : "Начните вводить запрос"}</div>`));
      return;
    }
    items.forEach((it, i) => {
      const el = h(`<div class="palette-item${i === focus ? " focus" : ""}" role="option">
        ${icon(it.ico || "chat", 17)}
        <div class="pi-body"><div class="pi-title">${highlightText(it.title, q)}</div>${it.sub ? `<div class="pi-sub">${it.snippet ? highlightText(it.sub, q) : esc(it.sub)}</div>` : ""}</div>
        ${it.right ? `<span class="pi-right">${esc(it.right)}</span>` : ""}</div>`);
      el.onmouseenter = () => { focus = i; [...list.children].forEach((c, k) => c.classList.toggle("focus", k === i)); };
      el.onclick = () => choose(i);
      list.appendChild(el);
    });
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    m.close();
    setTimeout(() => it.run(), 0);
  }

  const search = debounce(async q => {
    if (!q.trim()) {
      items = [
        ...commands(),
        ...state.chats.slice(0, 7).sort((a, b) => b.updatedAt - a.updatedAt).map(c => ({ title: c.title, sub: fmtDate(c.updatedAt, false), ico: "chat", run: () => bus.emit("openChat", c.id) })),
      ];
      render("");
      return;
    }
    const low = q.toLowerCase();
    const cmds = commands().filter(c => c.title.toLowerCase().includes(low));
    let chats = [];
    try {
      const { results } = await api.get("/api/search?q=" + encodeURIComponent(q));
      chats = results.map(c => {
        // не дублируем сниппет, если он почти повторяет название
        const same = c.snippet && c.snippet.replace(/^…/, "").trim().toLowerCase().startsWith(c.title.toLowerCase().replace(/…$/, ""));
        return { title: c.title, sub: !same && c.snippet ? c.snippet : fmtDate(c.updatedAt, false), snippet: !same && !!c.snippet, ico: "chat", run: () => bus.emit("openChat", c.id) };
      });
    } catch {}
    items = [...cmds, ...chats];
    focus = 0;
    render(q);
  }, 140);

  input.oninput = () => search(input.value);
  input.onkeydown = e => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); focus = Math.min(focus + 1, items.length - 1); render(input.value); scrollFocus(); }
    else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); focus = Math.max(focus - 1, 0); render(input.value); scrollFocus(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(focus); }
  };
  const scrollFocus = () => list.children[focus]?.scrollIntoView({ block: "nearest" });

  input.value = initial;
  search(initial);
  if (!isMobile()) setTimeout(() => input.focus(), 40);
}
