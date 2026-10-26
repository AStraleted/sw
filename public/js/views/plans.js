/* Экран тарифов: что входит, цены и как купить */
import { state } from "../state.js";
import { api } from "../api.js";
import { esc, h, fmtNum, fmtTokens, copyText } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, toast } from "../ui.js";

const FEATURES = [
  { key: "credits", label: "Кредитов при оплате" },
  { key: "tokens", label: "Это примерно токенов" },
  { key: "models", label: "Модели" },
  { key: "skills", label: "Скиллы" },
  { key: "preview", label: "Предпросмотр страниц" },
  { key: "maxFileMb", label: "Размер файла" },
  { key: "historyLimit", label: "Глубина переписки" },
  { key: "auto", label: "Авто-выбор модели" },
];

function valueOf(plan, key) {
  const f = plan.features;
  switch (key) {
    case "credits": return `<b>${fmtNum(plan.credits)}</b>`;
    case "tokens": return `≈ ${fmtTokens(plan.tokens)}`;
    case "models": return esc(f.models.join(", "));
    case "maxFileMb": return `${f.maxFileMb} МБ`;
    case "historyLimit": return `${f.historyLimit} сообщений`;
    default: return f[key]
      ? `<span style="color:var(--accent)">${icon("check", 16, 2.2)}</span>`
      : `<span style="color:var(--muted)">${icon("close", 15, 2)}</span>`;
  }
}

export async function openPlans(highlight) {
  let data;
  try { data = await api.get("/api/plans"); }
  catch (e) { toast(e.message, { type: "error" }); return; }
  state.plans = data.plans;

  const current = data.current?.id || "free";
  const tg = data.telegram || "wesfw";
  const box = h(`<div style="display:contents"></div>`);

  // текущая подписка
  if (data.current) {
    const c = data.current;
    const left = c.daysLeft != null ? `${c.daysLeft} дн. до конца` : "бессрочно";
    box.appendChild(h(`<div class="plan-now${c.expiring ? " warn" : ""}">
      <div><span class="label">Ваш тариф</span><b>${esc(c.name)}</b>${c.id !== "free" ? `<span class="muted"> · ${left}</span>` : ""}</div>
      <div class="plan-now-right"><span class="label">Осталось</span><b>${fmtNum(c.credits)}</b><span class="muted"> кр. ≈ ${fmtTokens(c.tokensLeft)} токенов</span></div>
    </div>`));
  }

  // карточки тарифов
  const grid = h(`<div class="plan-grid"></div>`);
  for (const p of data.plans) {
    const isCurrent = p.id === current;
    const best = p.id === "prem";
    const card = h(`<div class="plan-card${best ? " best" : ""}${isCurrent ? " current" : ""}${highlight === p.id ? " hl" : ""}">
      ${best ? `<span class="plan-flag">Выгоднее</span>` : ""}
      <div class="plan-head">
        <b>${esc(p.name)}</b>
        <span class="muted">${esc(p.summary)}</span>
      </div>
      <div class="plan-price">${p.price ? `${fmtNum(p.price)} <span>₽ / мес</span>` : `<span class="free">Бесплатно</span>`}</div>
      ${p.price ? `<div class="plan-year">${fmtNum(p.yearPrice)} ₽ за год — выгода ${data.yearDiscount}%</div>` : `<div class="plan-year">&nbsp;</div>`}
      <ul class="plan-list">
        <li><b>${fmtNum(p.credits)}</b> кредитов${p.days ? ` на ${p.days === 30 ? "месяц" : p.days + " дн."}` : ""}</li>
        <li>≈ <b>${fmtTokens(p.tokens)}</b> токенов</li>
        <li>${esc(p.features.models.join(", "))}</li>
        <li class="${p.features.skills ? "yes" : "no"}">${p.features.skills ? icon("check", 15, 2.2) : icon("close", 14, 2)}Скиллы</li>
        <li class="${p.features.preview ? "yes" : "no"}">${p.features.preview ? icon("check", 15, 2.2) : icon("close", 14, 2)}Предпросмотр страниц</li>
        <li>Файлы до ${p.features.maxFileMb} МБ</li>
      </ul>
      ${isCurrent
        ? `<button class="btn btn-outline btn-block" disabled>Ваш тариф</button>`
        : p.price
          ? `<button class="btn ${best ? "btn-accent" : "btn-primary"} btn-block" data-buy="${p.id}">Купить за ${fmtNum(p.price)} ₽</button>`
          : `<button class="btn btn-outline btn-block" disabled>Базовый</button>`}
    </div>`);
    grid.appendChild(card);
  }
  box.appendChild(grid);

  box.appendChild(h(`<div class="plan-foot">
    <div class="plan-buy">
      ${icon("sparkle", 18)}
      <div><b>Как купить</b><span>Напишите в Telegram — ответим и выдадим тариф на ваш аккаунт</span></div>
      <a class="btn btn-primary" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">@${esc(tg)}</a>
    </div>
    <p class="muted" style="font-size:12.5px;margin:14px 0 0">
      Кредиты списываются по реальному расходу: 1 кредит ≈ ${fmtNum(state.config.tokensPerCredit || 120000)} токенов на самой экономной модели.
      Дорогие модели расходуют кредиты быстрее, поэтому режим «Авто» сам подбирает модель под задачу и экономит баланс.
    </p>
  </div>`));

  const m = openModal({ title: "Тарифы", body: box, className: "plans-modal" });

  box.addEventListener("click", async e => {
    const id = e.target.closest("[data-buy]")?.dataset.buy;
    if (!id) return;
    const plan = data.plans.find(x => x.id === id);
    buyDialog(plan, tg, data.yearDiscount);
  });
  return m;
}

function buyDialog(plan, tg, discount) {
  const text = `Здравствуйте! Хочу тариф ${plan.name} для аккаунта ${state.user?.login || ""}.`;
  const body = h(`<div style="display:contents">
    <p style="margin:0 0 14px">Оплата проходит вручную: напишите в Telegram, и тариф выдадут на ваш аккаунт <b>${esc(state.user?.login || "")}</b>.</p>
    <div class="buy-rows">
      <label class="buy-row"><input type="radio" name="period" value="month" checked>
        <span><b>Месяц</b><span class="muted">${fmtNum(plan.price)} ₽</span></span></label>
      <label class="buy-row"><input type="radio" name="period" value="year">
        <span><b>Год</b><span class="muted">${fmtNum(plan.yearPrice)} ₽ вместо ${fmtNum(plan.price * 12)} ₽ — скидка ${discount}%</span></span></label>
    </div>
    <div class="buy-msg">
      <span class="label">Сообщение для отправки</span>
      <div class="buy-text" id="buyText">${esc(text)}</div>
    </div>
  </div>`);
  const foot = h(`<div style="display:contents">
    <button class="btn btn-ghost" data-copy>${icon("copy", 15)}Копировать</button>
    <a class="btn btn-primary" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">${icon("external", 15)}Написать @${esc(tg)}</a>
  </div>`);
  const dlg = openModal({ title: `Тариф ${plan.name}`, body, footer: foot });

  const update = () => {
    const period = body.querySelector("input:checked").value;
    const label = period === "year" ? "на год" : "на месяц";
    body.querySelector("#buyText").textContent = `Здравствуйте! Хочу тариф ${plan.name} ${label} для аккаунта ${state.user?.login || ""}.`;
  };
  body.querySelectorAll("input").forEach(i => i.onchange = update);
  foot.querySelector("[data-copy]").onclick = async e => {
    await copyText(body.querySelector("#buyText").textContent);
    toast("Сообщение скопировано");
  };
}
