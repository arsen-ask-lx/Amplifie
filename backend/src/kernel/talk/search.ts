import { SEARCH_TOTAL_CAP, searchWords } from "@amplifie/contract";
import { db } from "../../platform/db.js";
import type { Viewer } from "./access.js";
import * as repo from "./repo.js";
import { presentMessage } from "./service.js";
import { tsqueryOf } from "./tsquery.js";

/**
 * Поиск по сообщениям (task-100): слова → запрос → выдача с правами.
 *
 * ⚠️ ТАБЛИЦУ ПОИСКА ЗДЕСЬ НЕ ПИШЕТ НИКТО. Её держит в согласии с репликами
 * триггер в базе (миграция 0027): так её не забудет ни один путь записи.
 * Здесь только чтение.
 *
 * ⚠️ ПРАВА — ТЕ ЖЕ, ЧТО У ЛЕНТЫ, и проверяются в момент поиска
 * (`repo.searchMessagesPage`). В таблице поиска прав нет: появись завтра
 * «исключить из канала» — поиск не станет боковым каналом.
 *
 * Слов нет (пусто, одни однобуквенные) — пустая выдача без запроса к базе:
 * искать нечего, а запрос по всему словарю дорог.
 */
export async function searchMessages(
  viewer: Viewer,
  q: string,
  limit: number,
  before?: number,
  conversationId?: string,
) {
  const words = searchWords(q);
  const inRoom = conversationId !== undefined;
  // Искать нечего: пустая выдача без запроса к базе. Число всего при этом
  // ноль, а не «неизвестно»: попаданий и правда ноль.
  if (words.length === 0)
    return inRoom ? { items: [], next: null, total: 0 } : { items: [], next: null };

  const query = tsqueryOf(words);
  const rows = await repo.searchMessagesPage(db, viewer, query, limit, before, conversationId);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const found = {
    items: page.map((row) => ({
      ...presentMessage(row),
      conversationTitle: row.conversationTitle,
    })),
    next: rows.length > limit && last ? Number(last.seq) : null,
  };
  if (!inRoom) return found;

  /**
   * ⚠️ ЧИСЛО ВСЕГО СЧИТАЕТСЯ ТОЛЬКО ДЛЯ ЧАТА, И ТОЛЬКО ПЕРВОЙ СТРАНИЦЫ.
   * Счётчик «3 из 17» не меняется, пока человек ходит стрелками; повторный
   * подсчёт на каждой странице стоил бы того же, что сама страница.
   */
  const total =
    before === undefined
      ? await repo.countMatchesIn(db, viewer, query, conversationId, SEARCH_TOTAL_CAP)
      : undefined;
  return total === undefined ? found : { ...found, total };
}
