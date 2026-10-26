/* Обращения к серверу. Все запросы идут на тот же адрес, где открыт сайт. */
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, url, body) {
  const opts = { method, headers: { "X-Requested-With": "squled" }, credentials: "same-origin" };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); }
  catch { throw new ApiError(0, "Нет связи с сервером. Проверьте, что он запущен"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && api.onUnauthorized) api.onUnauthorized();
    throw new ApiError(res.status, data.error || `Ошибка ${res.status}`);
  }
  return data;
}

export const api = {
  onUnauthorized: null,
  get: url => request("GET", url),
  post: (url, body = {}) => request("POST", url, body),
  patch: (url, body = {}) => request("PATCH", url, body),
  del: url => request("DELETE", url),

  // Загрузка файла с прогрессом
  upload(file, onProgress) {
    let xhr;
    const promise = new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.setRequestHeader("X-Requested-With", "squled");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
        else reject(new ApiError(xhr.status, data.error || `Ошибка загрузки ${xhr.status}`));
      };
      xhr.onerror = () => reject(new ApiError(0, "Не удалось загрузить файл"));
      xhr.onabort = () => reject(new ApiError(0, "Загрузка отменена"));
      xhr.send(file);
    });
    return { promise, abort: () => xhr?.abort() };
  },

  // Отправка сообщения: ответ приходит потоком событий
  async stream(url, body, onEvent, signal) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST", signal, credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "squled" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e.name === "AbortError") return;
      throw new ApiError(0, "Нет связи с сервером");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && api.onUnauthorized) api.onUnauthorized();
      throw new ApiError(res.status, data.error || `Ошибка ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n\n")) > -1) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try { onEvent(JSON.parse(line.slice(5))); } catch (e) { console.error(e); }
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
  },
};
