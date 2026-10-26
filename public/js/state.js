/* Общее состояние приложения */
import { storage } from "./utils.js";

export const state = {
  user: null,
  models: [],
  efforts: [],
  config: {},
  plans: [],              // тарифы
  skillCatalog: [],       // встроенные скиллы
  chats: [],              // краткие сведения о чатах для сайдбара
  chatCache: new Map(),   // id → полный чат с сообщениями
  currentId: null,        // открытый чат (null — новый, ещё не созданный)
  draft: { model: null, effort: null }, // выбор модели для нового чата
  streams: new Map(),     // chatId → { controller, assistant }
  skills: [],
  sidebarCollapsed: storage.get("sidebarCollapsed", false),
};

export const AUTO_MODEL = { id: "auto", name: "Авто", family: "Авто", mult: 0, note: "Модель подбирается под задачу" };

export const currentChat = () => (state.currentId ? state.chatCache.get(state.currentId) : null);
export const modelById = id => (id === "auto" ? AUTO_MODEL : state.models.find(m => m.id === id)) || AUTO_MODEL;

// Возможности текущего тарифа
export const planFeatures = () => state.user?.plan?.features || { skills: false, preview: false, files: true, auto: true, maxFileMb: 10, models: [] };
export const can = name => !!planFeatures()[name];
export const effortById = id => state.efforts.find(e => e.id === id) || state.efforts[1];
export const isStreaming = (id = state.currentId) => !!id && state.streams.has(id);

// Текущие модель и сила: из открытого чата или черновика нового
export function activeModel() {
  const c = currentChat();
  return c?.model || state.draft.model || state.user?.settings?.defaultModel || state.config.defaultModel;
}
export function activeEffort() {
  const c = currentChat();
  return c?.effort || state.draft.effort || state.user?.settings?.defaultEffort || "medium";
}

// Простая шина событий между модулями
const listeners = {};
export const bus = {
  on(evt, fn) { (listeners[evt] ||= []).push(fn); },
  emit(evt, data) { (listeners[evt] || []).forEach(fn => fn(data)); },
};
