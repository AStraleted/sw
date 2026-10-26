/* =====================================================================
   ТАРИФЫ, ПОДПИСКИ И ЛИМИТЫ
   Всё решается здесь, на сервере. Браузер только показывает результат,
   поэтому подменой запросов тариф не расширить.
   ===================================================================== */
const CONFIG = require("./config");
const db = require("./db");
const { HttpError } = require("./http");

const DAY = 86400000;
const round2 = n => Math.round(n * 100) / 100;

/** Действующий тариф пользователя с учётом срока. */
function activePlan(user) {
  const sub = user.subscription;
  if (sub && sub.plan !== "free" && (!sub.until || sub.until > Date.now())) return CONFIG.planById(sub.plan);
  return CONFIG.PLANS.free;
}

const features = user => activePlan(user).features;

/** Проверка возможности: skills, preview, files. */
function requireFeature(user, name) {
  if (!features(user)[name]) {
    const need = Object.values(CONFIG.PLANS).find(p => p.features[name]);
    throw new HttpError(402, `Эта возможность доступна на тарифе ${need ? need.name : "выше"}. Откройте раздел «Тарифы»`);
  }
}

/** Разрешена ли модель на тарифе пользователя. */
function modelAllowed(user, model) {
  return features(user).models.includes(model.family);
}

function requireModel(user, model) {
  if (!modelAllowed(user, model)) {
    const need = Object.values(CONFIG.PLANS).sort((a, b) => a.order - b.order).find(p => p.features.models.includes(model.family));
    throw new HttpError(402, `${model.name} доступна на тарифе ${need ? need.name : "выше"}`);
  }
}

/** Сколько кредитов спишется за такой расход токенов. */
function costOf(model, input, output) {
  const weighted = input + output * CONFIG.OUTPUT_WEIGHT;
  return round2((weighted / CONFIG.TOKENS_PER_CREDIT) * model.mult);
}

/** Сколько примерно токенов осталось пользователю на самой дешёвой модели. */
function tokensLeft(user) {
  return Math.max(0, Math.round(user.credits * CONFIG.TOKENS_PER_CREDIT));
}

/** Проверка перед запросом: хватает ли кредитов и не превышены ли лимиты. */
function checkQuota(user) {
  if (user.credits <= 0) {
    const sub = user.subscription;
    const expired = sub && sub.plan !== "free" && sub.until && sub.until <= Date.now();
    throw new HttpError(402, expired
      ? "Срок подписки истёк. Продлите тариф, чтобы продолжить"
      : "Кредиты закончились. Откройте раздел «Тарифы», чтобы пополнить");
  }
}

/** Выдача тарифа администратором. period: "month" | "year". */
function grantPlan(user, planId, period = "month", addCredits = true) {
  const plan = CONFIG.PLANS[planId];
  if (!plan) throw new HttpError(400, "Неизвестный тариф");
  const now = Date.now();

  if (planId === "free") {
    user.subscription = { plan: "free", since: now, until: null, period: null };
    return user.subscription;
  }

  const months = period === "year" ? 12 : 1;
  const days = plan.days * months;
  const current = user.subscription;
  // Продление того же тарифа добавляет срок к остатку
  const base = current && current.plan === planId && current.until > now ? current.until : now;
  user.subscription = {
    plan: planId,
    period,
    since: current?.plan === planId ? current.since : now,
    until: base + days * DAY,
  };
  if (addCredits) user.credits = round2(user.credits + plan.credits * months);
  return user.subscription;
}

/** Сведения о тарифе для браузера. */
function planInfo(user) {
  const plan = activePlan(user);
  const sub = user.subscription || { plan: "free" };
  const daysLeft = sub.until ? Math.max(0, Math.ceil((sub.until - Date.now()) / DAY)) : null;
  return {
    id: plan.id,
    name: plan.name,
    features: plan.features,
    until: sub.until || null,
    daysLeft,
    period: sub.period || null,
    expiring: daysLeft !== null && daysLeft <= 5,
    credits: round2(user.credits),
    tokensLeft: tokensLeft(user),
  };
}

/** Список тарифов для экрана «Тарифы». */
function publicPlans() {
  return Object.values(CONFIG.PLANS)
    .sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id, name: p.name, summary: p.summary, credits: p.credits, days: p.days,
      price: p.price, yearPrice: CONFIG.yearPrice(p), features: p.features,
      tokens: Math.round(p.credits * CONFIG.TOKENS_PER_CREDIT),
    }));
}

/** Раз в час снимаем просроченные подписки. */
function sweepExpired() {
  const now = Date.now();
  let changed = false;
  for (const u of Object.values(db.data.users)) {
    const s = u.subscription;
    if (s && s.plan !== "free" && s.until && s.until <= now) {
      u.subscription = { plan: "free", since: now, until: null, period: null, expiredFrom: s.plan };
      changed = true;
    }
  }
  if (changed) db.save();
}
setInterval(sweepExpired, 3600 * 1000).unref();

module.exports = {
  activePlan, features, requireFeature, modelAllowed, requireModel,
  costOf, tokensLeft, checkQuota, grantPlan, planInfo, publicPlans, sweepExpired, round2,
};
