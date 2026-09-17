/**
 * Общее знание бека и фронта. Только объявления: ни запросов, ни узлов React.
 *
 * ⚠️ ДВА ПУТИ К ОДНОМУ ПАКЕТУ, И ЭТО НАМЕРЕННО. Бек берёт собранный
 * `dist` через ссылку проекта; сборщик фронта — исходник, по `paths`
 * в его tsconfig и по разрешению Vite. Здесь только объявления, отдельная
 * сборка ради них добавила бы фронту порядок сборки — лишнее звено, а
 * лишнее звено и есть то, что ломается.
 *
 * Правило пакета: сюда попадает то, что обе стороны обязаны понимать
 * ОДИНАКОВО. Не «то, что удобно переиспользовать» — иначе он превратится
 * в свалку общего назначения, а такой пакет связывает всех со всеми.
 */
export { MENTION_SOURCE, mentionedIds, mentionMarkup } from "./mentions.js";
export {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon,
} from "./projectLook.js";
export { searchFold, searchWords } from "./search.js";
export {
  eventOf,
  framed,
  nextDelay,
  RECONNECT,
  retryAfterMs,
  type StreamEvent,
} from "./stream.js";
