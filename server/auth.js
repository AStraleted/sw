/* =====================================================================
   АККАУНТЫ И СЕССИИ
   Пароли — scrypt с солью. Сессия — случайный токен в HttpOnly-cookie.
   ===================================================================== */
const crypto = require("crypto");
const CONFIG = require("./config");
const db = require("./db");
const { HttpError, parseCookies, setCookie } = require("./http");

const COOKIE = "sq_sid";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passHash, "hex"));
}

const normLogin = s => String(s || "").trim().toLowerCase();

function findByLogin(login) {
  const l = normLogin(login);
  return Object.values(db.data.users).find(u => u.login === l);
}

function validateCredentials(login, password) {
  const l = normLogin(login);
  if (!/^[a-z0-9_.\-а-яё]{3,32}$/i.test(l)) throw new HttpError(400, "Логин: 3–32 символа, буквы, цифры, точка, дефис или _");
  if (typeof password !== "string" || password.length < 6) throw new HttpError(400, "Пароль должен быть не короче 6 символов");
  if (password.length > 200) throw new HttpError(400, "Слишком длинный пароль");
  return l;
}

function createUser(login, password, name, { role } = {}) {
  const l = validateCredentials(login, password);
  if (findByLogin(l)) throw new HttpError(409, "Такой логин уже занят");
  // Админом становится только тот, кто указан в ADMIN_LOGINS. Все остальные — обычные пользователи.
  const isAdmin = role === "admin" || CONFIG.ADMIN_LOGINS.includes(l) || CONFIG.ADMIN_LOGIN.toLowerCase() === l;
  const { salt, hash } = hashPassword(password);
  const plan = CONFIG.planById(CONFIG.DEFAULT_PLAN);
  const user = {
    id: crypto.randomUUID(),
    login: l,
    name: String(name || "").trim().slice(0, 40) || login.trim(),
    salt,
    passHash: hash,
    role: isAdmin ? "admin" : "user",
    credits: isAdmin ? 100000 : plan.credits,
    subscription: { plan: isAdmin ? "prem" : plan.id, since: Date.now(), until: null, period: null },
    disabled: false,
    createdAt: Date.now(),
    settings: { systemPrompt: "", defaultModel: CONFIG.DEFAULT_MODEL, defaultEffort: "medium", sendOnEnter: true },
  };
  db.data.users[user.id] = user;
  db.save();
  return user;
}

/** Создаёт администратора при первом запуске, если он задан в .env */
function seedAdmin() {
  const { ADMIN_LOGIN, ADMIN_PASSWORD } = CONFIG;
  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) return;
  if (findByLogin(ADMIN_LOGIN)) return;
  try {
    createUser(ADMIN_LOGIN, ADMIN_PASSWORD, ADMIN_LOGIN, { role: "admin" });
    console.log(`  Создан администратор: ${ADMIN_LOGIN}`);
    console.log("  Смените пароль после первого входа: Настройки → Профиль");
  } catch (e) {
    console.error("  Не удалось создать администратора:", e.message);
  }
}

function createSession(res, user, req) {
  const token = crypto.randomBytes(32).toString("hex");
  const maxAge = CONFIG.SESSION_DAYS * 86400;
  // Отпечаток браузера: украденную cookie сложнее использовать с другого устройства
  const fp = fingerprint(req);
  db.data.sessions[token] = { userId: user.id, fp, created: Date.now(), expires: Date.now() + maxAge * 1000 };
  // Не больше 10 одновременных сессий на аккаунт
  const own = Object.entries(db.data.sessions).filter(([, s]) => s.userId === user.id).sort((a, b) => a[1].created - b[1].created);
  while (own.length > 10) delete db.data.sessions[own.shift()[0]];
  db.save();
  setCookie(res, COOKIE, token, maxAge);
}

function fingerprint(req) {
  if (!req) return "";
  const ua = String(req.headers["user-agent"] || "");
  const lang = String(req.headers["accept-language"] || "").slice(0, 40);
  return crypto.createHash("sha256").update(ua + "|" + lang).digest("hex").slice(0, 16);
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) { delete db.data.sessions[token]; db.save(); }
  setCookie(res, COOKIE, "", 0);
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = db.data.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.data.sessions[token]; db.save(); return null; }
  // Сессию с другого браузера считаем чужой
  if (s.fp && s.fp !== fingerprint(req)) { delete db.data.sessions[token]; db.save(); return null; }
  const user = db.data.users[s.userId];
  if (!user || user.disabled) return null;
  return user;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, "Нужно войти в аккаунт");
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== "admin") throw new HttpError(403, "Только для администратора");
  return user;
}

// Что из профиля можно отдавать в браузер
function publicUser(u) {
  const plans = require("./plans");
  return {
    id: u.id, login: u.login, name: u.name, role: u.role,
    credits: Math.round(u.credits * 100) / 100,
    createdAt: u.createdAt, disabled: !!u.disabled, settings: u.settings,
    plan: plans.planInfo(u),
  };
}

// Удаляем просроченные сессии раз в час
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of Object.entries(db.data.sessions)) if (s.expires < now) { delete db.data.sessions[t]; changed = true; }
  if (changed) db.save();
}, 3600 * 1000).unref();

module.exports = {
  hashPassword, verifyPassword, findByLogin, createUser, seedAdmin, createSession, destroySession,
  currentUser, requireUser, requireAdmin, publicUser, validateCredentials, normLogin,
};
