import { api, type Message } from "./api.js";
import { merge } from "./feed.js";

/**
 * Страницы ленты разговора: сколько брать и как долистать до реплики
 * по цитате (task-098 — вынесено из `useChat` вместе со своим знанием).
 */

export const FEED_PAGE = 50;

/**
 * Долистать назад, пока нужная реплика не окажется в ленте.
 *
 * Ограничение по числу страниц, а не «пока не найдём»: цитата может
 * указывать на удалённое сообщение, и тогда цикл вечен.
 */
const BACK_PAGES = 10;

export async function pageBackTo(
  conversationId: string,
  start: { items: Message[]; hasMore: boolean; head: number },
  want: number,
): Promise<{ items: Message[]; hasMore: boolean; head: number }> {
  let all = start.items;
  let more = start.hasMore;

  for (let page = 0; more && page < BACK_PAGES; page++) {
    const oldest = all[0]?.seq;
    if (oldest === undefined || oldest <= want) break;
    const older = await api.messages(conversationId, { limit: FEED_PAGE, before: oldest });
    all = merge(all, older.items);
    more = older.hasMore;
  }
  // Голова остаётся той, что назвал сервер при первой странице: догрузка
  // старого не двигает конец пространства.
  return { items: all, hasMore: more, head: start.head };
}
