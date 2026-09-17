import { searchWords } from "@amplifie/contract";
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
export async function searchMessages(viewer: Viewer, q: string, limit: number, before?: number) {
  const words = searchWords(q);
  if (words.length === 0) return { items: [], next: null };
  const rows = await repo.searchMessagesPage(db, viewer, tsqueryOf(words), limit, before);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      ...presentMessage(row),
      conversationTitle: row.conversationTitle,
    })),
    next: rows.length > limit && last ? Number(last.seq) : null,
  };
}
