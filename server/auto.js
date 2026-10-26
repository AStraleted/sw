/* =====================================================================
   АВТО-ВЫБОР МОДЕЛИ
   Разбирает запрос и ставит самую дешёвую модель, которая справится.
   Простое — Haiku, обычное — Sonnet, сложное — Opus.
   Решение принимает сервер, поэтому подменить его из браузера нельзя.
   ===================================================================== */
const CONFIG = require("./config");
const plans = require("./plans");

// Слова, по которым видно сложную работу
const HARD = [
  "архитектур", "спроектируй", "спроектировать", "рефактор", "оптимизируй", "оптимизац",
  "почему не работает", "не работает", "ошибк", "баг", "отлад", "debug", "исправь",
  "докажи", "выведи формулу", "алгоритм", "сложност", "производительност", "уязвим", "безопасн",
  "сравни подход", "разбери код", "код-ревью", "ревью", "проанализируй", "стратеги", "бизнес-план",
  "напиши приложение", "напиши сайт", "напиши игру", "полноценн", "с нуля", "многопоточ", "асинхрон",
  "migration", "architecture", "refactor", "optimize", "analyze", "design a", "implement",
];

// Слова, по которым видно простую работу
const SIMPLE = [
  "переведи", "перевод", "как пишется", "синоним", "сколько будет", "посчитай",
  "что такое", "кто такой", "когда был", "где находится", "сокращ", "список",
  "исправь опечат", "проверь орфограф", "кратко", "в двух словах", "одним предложением",
  "привет", "спасибо", "как дела", "погода", "время",
  "translate", "summarize briefly", "what is", "who is",
];

// Работа с кодом — обычно не для самой слабой модели
const CODE = [
  "код", "функци", "класс", "скрипт", "программ", "python", "javascript", "java", "sql", "html", "css",
  "react", "node", "api", "регулярк", "regex", "bash", "docker", "лендинг", "сайт", "страниц", "верстк",
  "интерфейс", "кнопк", "форму", "запрос к базе", "таблиц",
];

// Создание чего-либо: даже короткая просьба означает полноценную работу
const MAKE = [
  "напиши", "составь", "сделай", "создай", "сгенерируй", "придумай", "сочини", "разработай",
  "подготовь", "собери", "нарисуй", "оформи", "переделай", "дополни", "расширь",
  "write", "create", "make", "build", "generate",
];

// Объёмная работа: тут даже короткая просьба означает много кода
const BIG = ["лендинг", "сайт", "приложение", "игру", "игра", "интерфейс", "дашборд", "панель", "систему", "сервис", "бот", "парсер", "страницу", "калькулятор", "магазин"];

// Разбор и объяснение — средний уровень, слабой модели не хватает
const EXPLAIN = ["объясни", "расскажи", "почему", "как работает", "в чём разница", "чем отличается", "разбер", "сравни"];

/**
 * Выбирает модель и силу рассуждений под задачу.
 * @returns { model, effort, reason, level }
 */
function pick(user, { text = "", attachments = [], historyLength = 0, hasSkills = false }) {
  const t = String(text).toLowerCase();
  const len = t.length;
  const has = list => list.some(w => t.includes(w));

  let level = "normal";
  const why = [];
  const creating = has(MAKE); // просят что-то создать, а не просто ответить

  // 1. Явные признаки сложной задачи
  if (has(HARD)) { level = "hard"; why.push("сложная задача"); }
  // 2. Очень длинный запрос или большая переписка
  else if (len > 1500) { level = "hard"; why.push("длинный запрос"); }
  else if (historyLength > 16) { level = "hard"; why.push("длинная переписка"); }
  // 3. Создать что-то объёмное — дорогая модель оправдана
  else if (creating && (has(BIG) || (has(CODE) && len > 140))) { level = "hard"; why.push("разработка"); }
  else if (creating && has(CODE)) { why.push("работа с кодом"); }
  else if (has(CODE)) { why.push("работа с кодом"); }
  else if (creating) { why.push("создание текста"); }
  else if (has(EXPLAIN)) { why.push("разбор темы"); }
  // 4. Простой короткий вопрос — только если ничего создавать не просят
  else if (has(SIMPLE) && len < 220) { level = "simple"; why.push("короткий вопрос"); }
  else if (len < 60 && !attachments.length) { level = "simple"; why.push("короткий вопрос"); }

  // Файлы поднимают уровень: их нужно разобрать
  if (attachments.length) {
    const heavy = attachments.some(a => a.type === "application/pdf" || a.size > 200000);
    if (level === "simple") level = "normal";
    if (heavy && level === "normal") { level = "hard"; why.push("большой файл"); }
    else why.push(attachments.length > 1 ? "файлы" : "файл");
  }
  // Подключённые скиллы — инструкций много, слабая модель хуже их держит
  if (hasSkills && level === "simple") { level = "normal"; why.push("подключены скиллы"); }

  const chosen = CONFIG.AUTO_MODELS[level];
  let model = CONFIG.MODELS.find(m => m.id === chosen.model);

  // Если тариф не открывает эту модель — берём лучшую из доступных
  if (!plans.modelAllowed(user, model)) {
    const allowed = CONFIG.MODELS.filter(m => plans.modelAllowed(user, m));
    model = allowed.sort((a, b) => b.mult - a.mult)[0] || CONFIG.MODELS[CONFIG.MODELS.length - 1];
    why.push("ограничение тарифа");
  }

  // Мало кредитов — не тратим их на дорогую модель
  const cheap = CONFIG.MODELS.filter(m => plans.modelAllowed(user, m)).sort((a, b) => a.mult - b.mult)[0];
  if (user.credits < 15 && cheap && model.mult > cheap.mult) {
    model = cheap;
    why.push("мало кредитов");
  }

  return {
    model: model.id,
    effort: chosen.effort,
    level,
    reason: why[0] || "обычная задача",
  };
}

module.exports = { pick };
