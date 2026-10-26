/* =====================================================================
   ХРАНИЛИЩЕ
   Без базы данных: JSON-файлы в папке data/.
     data/db.json            пользователи, сессии, файлы, скиллы, расход
     data/chats/<userId>.json чаты пользователя
     data/uploads/<fileId>   загруженные файлы
   Запись атомарная (через временный файл) и с небольшой задержкой,
   чтобы при стриминге не писать на диск на каждый символ.
   ===================================================================== */
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");

const DIR = CONFIG.DATA_DIR;
const CHATS_DIR = path.join(DIR, "chats");
const UPLOADS_DIR = path.join(DIR, "uploads");
const DB_FILE = path.join(DIR, "db.json");

for (const d of [DIR, CHATS_DIR, UPLOADS_DIR]) fs.mkdirSync(d, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// Отложенная запись: собираем изменения и пишем раз в 300 мс
const timers = new Map();
function scheduleWrite(file, getData, delay = 300) {
  if (timers.has(file)) return;
  timers.set(file, setTimeout(() => {
    timers.delete(file);
    try { writeJsonAtomic(file, getData()); } catch (e) { console.error("Ошибка записи", file, e.message); }
  }, delay));
}

// ---------------- основная база ----------------
const data = Object.assign(
  { users: {}, sessions: {}, files: {}, skills: {}, usage: {}, audit: [] },
  readJson(DB_FILE, {})
);

function save() { scheduleWrite(DB_FILE, () => data); }

// ---------------- чаты ----------------
const chatCache = new Map();
const chatFile = userId => path.join(CHATS_DIR, `${userId}.json`);

function getChats(userId) {
  if (!chatCache.has(userId)) {
    const chats = readJson(chatFile(userId), []);
    for (const c of chats) delete c.busy; // флаг «идёт ответ» не переживает перезапуск
    chatCache.set(userId, chats);
  }
  return chatCache.get(userId);
}

function saveChats(userId) { scheduleWrite(chatFile(userId), () => getChats(userId)); }

// Принудительно сбросить всё на диск (при выходе)
function flush() {
  for (const [file, t] of timers) clearTimeout(t);
  timers.clear();
  writeJsonAtomic(DB_FILE, data);
  for (const [userId, chats] of chatCache) writeJsonAtomic(chatFile(userId), chats);
}

const uploadPath = id => path.join(UPLOADS_DIR, id.replace(/[^a-zA-Z0-9_-]/g, ""));

// Полное удаление чатов пользователя
function dropUser(userId) {
  chatCache.delete(userId);
  const f = chatFile(userId);
  if (timers.has(f)) { clearTimeout(timers.get(f)); timers.delete(f); }
  fs.rmSync(f, { force: true });
}

module.exports = { data, save, getChats, saveChats, flush, uploadPath, dropUser, UPLOADS_DIR };
