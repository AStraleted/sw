/* =====================================================================
   НАСТРОЙКИ СЕРВЕРА
   Значения берутся из файла .env в корне проекта (см. .env.example).
   Здесь же список моделей и правила списания кредитов.
   ===================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Простой загрузчик .env без зависимостей
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, ".env"));

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
const num = (k, d) => Number(env(k, d));
const bool = (k, d) => String(env(k, d)).toLowerCase() === "true";

const API_TOKEN = env("API_TOKEN", "");

const CONFIG = {
  ROOT,
  PORT: num("PORT", 8787),
  HOST: env("HOST", "127.0.0.1"),
  PUBLIC_DIR: path.join(ROOT, "public"),
  DATA_DIR: path.resolve(ROOT, env("DATA_DIR", "data")),

  // ---- API ----
  UPSTREAM: env("UPSTREAM_URL", "https://api.inferhold.com").replace(/\/$/, ""),
  API_TOKEN,
  // Как передавать токен: "bearer" (Authorization: Bearer) или "x-api-key"
  AUTH_HEADER: env("AUTH_HEADER", "bearer"),
  // Демо-режим: ответы генерируются локально, ключ не нужен. Включается сам, если токена нет.
  MOCK: bool("MOCK", "false") || !API_TOKEN,

  // ---- аккаунты ----
  ALLOW_REGISTRATION: bool("ALLOW_REGISTRATION", "true"),
  // Логины администраторов через запятую. Все остальные — обычные пользователи.
  ADMIN_LOGINS: env("ADMIN_LOGINS", "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  // Админ создаётся при первом запуске, если указаны оба значения
  ADMIN_LOGIN: env("ADMIN_LOGIN", ""),
  ADMIN_PASSWORD: env("ADMIN_PASSWORD", ""),
  SESSION_DAYS: num("SESSION_DAYS", 30),
  // true, если сайт открыт по https (на хостинге)
  COOKIE_SECURE: bool("COOKIE_SECURE", "false"),
  // Если сервер стоит за nginx/Cloudflare — true, чтобы брать IP из X-Forwarded-For
  TRUST_PROXY: bool("TRUST_PROXY", "false"),

  // ---- лимиты ----
  MAX_FILE_MB: num("MAX_FILE_MB", 200),
  MAX_HISTORY: num("MAX_HISTORY", 24),          // сколько последних сообщений уходит модели
  MAX_TEXT_FILE_CHARS: num("MAX_TEXT_FILE_CHARS", 200000),
  MAX_SKILL_CHARS: num("MAX_SKILL_CHARS", 12000),

  // ---- кредиты и токены ----
  // Базовая ставка: сколько токенов стоит один кредит на самой дешёвой модели (множитель ×1).
  // 120 000 × 500 кредитов = 60 млн токенов — как на тарифе PRO.
  TOKENS_PER_CREDIT: num("TOKENS_PER_CREDIT", 120000),
  // Токен на выход дороже токена на вход во столько раз
  OUTPUT_WEIGHT: num("OUTPUT_WEIGHT", 5),

  // ---- тарифы ----
  // credits — кредиты при выдаче; days — срок; features — что открыто.
  // Выдаются через админ-панель. Оплата вручную, через Telegram.
  CONTACT_TELEGRAM: env("CONTACT_TELEGRAM", "wesfw"),
  YEAR_DISCOUNT: num("YEAR_DISCOUNT", 15), // скидка на год, проценты
  PLANS: {
    free: {
      id: "free", name: "Бесплатный", credits: 25, days: 0, price: 0, order: 0,
      summary: "Чтобы попробовать",
      features: { skills: false, preview: false, files: true, auto: true, maxFileMb: 10, historyLimit: 12, models: ["Haiku", "Sonnet"] },
    },
    pro: {
      id: "pro", name: "PRO", credits: 500, days: 30, price: 250, order: 1,
      summary: "Для повседневной работы",
      features: { skills: false, preview: false, files: true, auto: true, maxFileMb: 50, historyLimit: 24, models: ["Haiku", "Sonnet", "Opus"] },
    },
    prem: {
      id: "prem", name: "PREM", credits: 1100, days: 30, price: 650, order: 2,
      summary: "Всё без ограничений",
      features: { skills: true, preview: true, files: true, auto: true, maxFileMb: 200, historyLimit: 40, models: ["Haiku", "Sonnet", "Opus", "Fable"] },
    },
  },
  // Что получает новый аккаунт
  DEFAULT_PLAN: env("DEFAULT_PLAN", "free"),

  // ---- авто-выбор модели ----
  // Какие модели подставляются в режиме «Авто» под задачу разной сложности
  AUTO_MODELS: {
    simple: { model: "claude-haiku-5-5", effort: "low" },
    normal: { model: "claude-sonnet-5-5", effort: "medium" },
    hard:   { model: "claude-opus-5-5",  effort: "high" },
  },

  // ---- модели ----
  // thinking: "adaptive" — новые модели (effort), "budget" — старый бюджет токенов, "none" — без рассуждений.
  // Если API не примет выбранный режим, сервер сам попробует следующий и запомнит рабочий.
  MODELS: [
    { id: "claude-fable-5-1",  name: "Claude Fable 5.1",  family: "Fable",  mult: 8,   thinking: "adaptive", note: "Самая сильная модель" },
    { id: "claude-fable-5",    name: "Claude Fable 5",    family: "Fable",  mult: 8,   thinking: "adaptive" },
    { id: "claude-opus-5-5",   name: "Claude Opus 5.5",   family: "Opus",   mult: 4,   thinking: "adaptive", note: "Сложные задачи и код", default: true },
    { id: "claude-opus-5",     name: "Claude Opus 5",     family: "Opus",   mult: 4,   thinking: "adaptive" },
    { id: "claude-opus-4-8",   name: "Claude Opus 4.8",   family: "Opus",   mult: 4,   thinking: "adaptive" },
    { id: "claude-opus-4-7",   name: "Claude Opus 4.7",   family: "Opus",   mult: 4,   thinking: "adaptive" },
    { id: "claude-opus-4-6",   name: "Claude Opus 4.6",   family: "Opus",   mult: 4,   thinking: "adaptive" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", family: "Sonnet", mult: 2,   thinking: "adaptive", note: "Быстрая и умная" },
    { id: "claude-sonnet-5",   name: "Claude Sonnet 5",   family: "Sonnet", mult: 2,   thinking: "adaptive" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", family: "Sonnet", mult: 2,   thinking: "adaptive" },
    { id: "claude-haiku-5-5",  name: "Claude Haiku 5.5",  family: "Haiku",  mult: 1.5, thinking: "adaptive", note: "Самая быстрая и дешёвая" },
    { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  family: "Haiku",  mult: 1.3, thinking: "budget" },
  ],

  // Уровни силы рассуждений: effort — для adaptive, budget — для старого режима
  EFFORTS: {
    low:    { label: "Быстро",  hint: "Короткие ответы без долгих размышлений", effort: "low",    budget: 1024,  maxTokens: 8192 },
    medium: { label: "Обычно",  hint: "Баланс скорости и качества",            effort: "medium", budget: 4096,  maxTokens: 16000 },
    high:   { label: "Глубоко", hint: "Максимум размышлений для сложных задач", effort: "high",   budget: 16000, maxTokens: 32000 },
  },

  // Базовая инструкция модели. Пользователь может дописать свою в настройках.
  BASE_SYSTEM_PROMPT:
    "Ты — ассистент в рабочем пространстве SQULED Studio. Отвечай на языке пользователя, ясно и по делу. " +
    "Используй Markdown: заголовки, списки и таблицы — когда они помогают. " +
    "Код, длинные тексты и документы оформляй блоком ``` с указанием языка (html, py, js, json, md и т.д.) — " +
    "пользователь сможет скопировать или скачать его файлом, а HTML — сразу открыть в предпросмотре.",
};

CONFIG.DEFAULT_MODEL = "auto";
CONFIG.planById = id => CONFIG.PLANS[id] || CONFIG.PLANS.free;
// Цена за год со скидкой
CONFIG.yearPrice = plan => Math.round(plan.price * 12 * (1 - CONFIG.YEAR_DISCOUNT / 100));

module.exports = CONFIG;
