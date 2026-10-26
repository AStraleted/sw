/* =====================================================================
   HTTP-ПОМОЩНИКИ: маршрутизатор, чтение тела, cookie, ответы
   ===================================================================== */
const CONFIG = require("./config");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (CONFIG.COOKIE_SECURE) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, "Слишком большой запрос");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch { throw new HttpError(400, "Некорректный JSON"); }
}

function clientIp(req) {
  if (CONFIG.TRUST_PROXY && req.headers["x-forwarded-for"]) return req.headers["x-forwarded-for"].split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

// Мини-роутер: router.add("GET", "/api/chats/:id", handler)
function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
      routes.push({ method, re, keys, handler });
    },
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.re);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

// Простое ограничение частоты: не больше limit событий за windowMs с одного ключа
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length <= limit;
  };
}

module.exports = { HttpError, sendJson, parseCookies, setCookie, readBody, readJsonBody, clientIp, createRouter, rateLimiter };
