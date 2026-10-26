/* =====================================================================
   SQULED STUDIO — сервер
   Отдаёт сайт из public/ и API из /api. Запуск: node server/index.js
   ===================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");
const db = require("./db");
const { handleApi } = require("./routes");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "SAMEORIGIN",
  // Предпросмотр HTML работает в iframe с srcdoc и sandbox, поэтому frame-src разрешает только его
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // Предпросмотр открывается через /api/preview/<id> в том же источнике, но в песочнице
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; "),
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || !path.extname(rel)) rel = "/index.html"; // одностраничное приложение
  const file = path.normalize(path.join(CONFIG.PUBLIC_DIR, rel));
  if (!file.startsWith(CONFIG.PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Не найдено"); }
    const ext = path.extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      // HTML всегда свежий, остальное кэшируется ненадолго
      "Cache-Control": ext === ".html" ? "no-cache" : ext === ".woff" || ext === ".woff2" ? "public, max-age=2592000" : "public, max-age=300",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

server.requestTimeout = 0;      // длинные ответы модели и большие файлы
server.headersTimeout = 60000;

require("./auth").seedAdmin();
require("./plans").sweepExpired();

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  const url = `http://${CONFIG.HOST === "0.0.0.0" ? "localhost" : CONFIG.HOST}:${CONFIG.PORT}`;
  console.log("");
  console.log("  SQULED STUDIO");
  console.log(`  Откройте: ${url}`);
  console.log(CONFIG.MOCK ? "  Демо-режим: API_TOKEN не задан, ответы генерируются локально" : `  API: ${CONFIG.UPSTREAM}`);
  console.log("");
});

function shutdown() {
  try { db.flush(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
