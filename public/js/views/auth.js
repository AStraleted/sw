/* Экран входа и регистрации */
import { api } from "../api.js";
import { $, esc } from "../utils.js";
import { icon } from "../icons.js";
import { mark } from "../logo.js";

let mode = "login";

export function showAuth(config, onSuccess) {
  const root = $("#auth");
  root.classList.remove("hidden");
  $("#app").classList.add("hidden");
  render(root, config, onSuccess, true);
}

export function hideAuth() {
  $("#auth").classList.add("hidden");
  $("#auth").innerHTML = "";
}

function render(root, config, onSuccess, first = false) {
  const isLogin = mode === "login";
  root.innerHTML = `
    <div class="auth-box">
      ${mark(56, first ? "draw idle" : "idle")}
      <h1 class="auth-title">${isLogin ? "С возвращением" : "Создайте аккаунт"}</h1>
      <p class="auth-sub">${isLogin ? "Войдите, чтобы продолжить работу в SQULED Studio" : "Рабочее пространство для работы с моделями Claude"}</p>
      <form class="auth-form" novalidate>
        ${isLogin ? "" : `<div class="field"><label for="aName">Как к вам обращаться</label><input class="input" id="aName" autocomplete="name" placeholder="Например, Давид" maxlength="40"></div>`}
        <div class="field"><label for="aLogin">Логин</label><input class="input" id="aLogin" autocomplete="username" placeholder="Ваш логин" required autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="aPass">Пароль</label>
          <div class="pass-wrap"><input class="input" id="aPass" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="${isLogin ? "Ваш пароль" : "Не короче 6 символов"}" required>
          <button class="icon-btn" type="button" id="aEye" aria-label="Показать пароль">${icon("eye", 16)}</button></div>
        </div>
        <div class="auth-error" id="aErr" role="alert"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" id="aBtn">${isLogin ? "Войти" : "Создать аккаунт"}</button>
      </form>
      ${config.allowRegistration || !isLogin ? `<div class="auth-switch">${isLogin ? "Нет аккаунта?" : "Уже есть аккаунт?"} <button type="button" id="aSwitch">${isLogin ? "Зарегистрироваться" : "Войти"}</button></div>` : ""}
      <div class="auth-foot">${config.mock ? `<span class="badge accent">Демо-режим</span>` : ""}<span>SQULED Studio · ${new Date().getFullYear()}</span></div>
    </div>`;

  const form = root.querySelector("form");
  const err = $("#aErr", root);
  const btn = $("#aBtn", root);
  const pass = $("#aPass", root);

  $("#aEye", root).onclick = e => {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    e.currentTarget.innerHTML = icon(show ? "eyeOff" : "eye", 16);
  };
  $("#aSwitch", root)?.addEventListener("click", () => { mode = isLogin ? "register" : "login"; render(root, config, onSuccess); });

  form.onsubmit = async e => {
    e.preventDefault();
    err.textContent = "";
    const login = $("#aLogin", root).value.trim();
    const password = pass.value;
    if (!login || !password) { err.textContent = "Введите логин и пароль"; return; }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const body = { login, password };
      if (!isLogin) body.name = $("#aName", root).value.trim();
      const { user } = await api.post(isLogin ? "/api/auth/login" : "/api/auth/register", body);
      onSuccess(user);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = isLogin ? "Войти" : "Создать аккаунт";
      form.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: 320, easing: "ease-out" });
    }
  };
  requestAnimationFrame(() => $(isLogin ? "#aLogin" : "#aName", root)?.focus());
}

export { esc };
