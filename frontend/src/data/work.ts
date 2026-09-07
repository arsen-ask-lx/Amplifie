import type { Agreement } from "./api.js";

/**
 * Чистая часть экрана работы: как разложить договорённости и что скрыть.
 *
 * Отдельным файлом, потому что это единственное место экрана, где можно
 * ошибиться незаметно, — и единственное, что проверяется без браузера.
 */

/** Статусы, которые экран знает в лицо. Их же стережёт CHECK в базе. */
const AWAITING = "proposed";
const REFUSED = "rejected";
const DONE_WITH = "confirmed";

/** Ждут решения человека. Ради них экран и существует. */
export function awaiting(items: Agreement[]): Agreement[] {
  return items.filter((item) => item.status === AWAITING);
}

/** Отклонённые. Не мусор: «решили не делать» — тоже договорённость. */
export function refused(items: Agreement[]): Agreement[] {
  return items.filter((item) => item.status === REFUSED);
}

/**
 * Ни в один список не попавшие.
 *
 * Подтверждённые сюда не относятся: они видны в задачах, и показывать их
 * дважды значит превратить список задач в необязательный. А вот статус,
 * которого экран не знает, обязан быть виден: молча пропавшая
 * договорённость — это потерянная работа.
 */
export function strays(items: Agreement[]): Agreement[] {
  const known = new Set([AWAITING, REFUSED, DONE_WITH]);
  return items.filter((item) => !known.has(item.status));
}

/** Разница только в пробелах и регистре — считаем текст тем же. */
function plain(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * Цитата целиком содержится в тексте договорённости — второй раз незачем.
 *
 * Вхождение, а не равенство: сегодня агент пишет «Имя: реплика», и при
 * сравнении на равенство приставка с именем делала два одинаковых абзаца
 * подряд. Поймано глазами на живом экране, а не тестом.
 *
 * Повтор одного и того же дважды учит человека пролистывать источник,
 * а источник — единственное, чем он может поймать выдумку агента (А-2).
 */
export function quoteAddsNothing(text: string, quote: string): boolean {
  const said = plain(quote);
  return said.length > 0 && plain(text).includes(said);
}
