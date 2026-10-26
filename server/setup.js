/* =====================================================================
   ПЕРВОНАЧАЛЬНАЯ НАСТРОЙКА
   Запуск: npm run setup
   Задаёт несколько вопросов и создаёт файл .env
   ===================================================================== */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const ENV = path.join(ROOT, ".env");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = "") => new Promise(r => rl.question(def ? `${q} [${def}]: ` : `${q}: `, a => r(a.trim() || def)));

(async () => {
  console.log("\n  SQULED STUDIO — настройка\n");

  if (fs.existsSync(ENV)) {
    const again = await ask("Файл .env уже есть. Создать заново? (да/нет)", "нет");
    if (!/^(да|y|yes)$/i.test(again)) { console.log("Оставляю как есть."); rl.close(); return; }
  }

  const token = await ask("API-токен сервиса (Enter — пропустить, будет демо-режим)");
  const upstream = await ask("Адрес API", "https://api.inferhold.com");
  const port = await ask("Порт сервера", "8787");
  const open = await ask("Открыть доступ из сети, не только с этого ПК? (да/нет)", "нет");
  const reg = await ask("Разрешить всем регистрироваться? (да/нет)", "да");
  const credits = await ask("Сколько кредитов давать новому аккаунту", "100");
  const admin = await ask("Логин администратора (Enter — им станет первый зарегистрированный)");
  const https = await ask("Сайт будет работать по https? (да/нет)", "нет");

  const yes = v => /^(да|y|yes|true)$/i.test(v);
  const lines = [
    `API_TOKEN=${token}`,
    `UPSTREAM_URL=${upstream}`,
    `AUTH_HEADER=bearer`,
    ``,
    `PORT=${port}`,
    `HOST=${yes(open) ? "0.0.0.0" : "127.0.0.1"}`,
    `DATA_DIR=data`,
    ``,
    `ALLOW_REGISTRATION=${yes(reg)}`,
    `START_CREDITS=${credits}`,
    `ADMIN_LOGINS=${admin.toLowerCase()}`,
    `COOKIE_SECURE=${yes(https)}`,
    `TRUST_PROXY=${yes(https)}`,
    ``,
    `MAX_FILE_MB=200`,
    `MAX_HISTORY=24`,
    `CREDITS_PER_1K_INPUT=0.05`,
    `CREDITS_PER_1K_OUTPUT=0.25`,
    ``,
  ];
  fs.writeFileSync(ENV, lines.join("\n"), { mode: 0o600 });

  console.log(`\n  Готово: ${ENV}`);
  if (!token) console.log("  Токен не задан — сайт запустится в демо-режиме.");
  console.log("  Запуск: npm start\n");
  rl.close();
})();
