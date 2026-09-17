import { api, type Message } from "./api.js";

/**
 * Страницы ленты разговора: сколько брать и как открыть ленту вокруг
 * реплики (task-098 — вынесено из `useChat`; task-099 — лента с двумя краями).
 */

export const FEED_PAGE = 50;

/** Страница ленты вместе с тем, что за её краями. */
export interface FeedWindow {
  items: Message[];
  /** Есть ли старше нижнего края. */
  hasOlder: boolean;
  /** Есть ли новее верхнего края; `false` — страница доходит до конца. */
  hasNewer: boolean;
  /** Голова пространства, прочитанная сервером ДО строк, — курсор догона. */
  head: number;
}

/**
 * Лента вокруг реплики: до неё включительно и после неё (task-099).
 *
 * ⚠️ ДВА ЗАПРОСА С ОБЩЕЙ ГРАНИЦЕЙ, А НЕ ЛИСТАНИЕ НАЗАД. Прежде лента
 * листала назад не больше десяти страниц — пятьсот реплик, — и давнее
 * сообщение открывало чат без подсветки. Здесь цена одна при любой давности.
 * Дыры между половинами нет по построению: `< номер + 1` и `> номер`.
 *
 * Цель в последней странице — половина «после» неполная, и лента сразу
 * в конце: отдельной развилки «близко или далеко» не нужно.
 *
 * Голова — меньшая из двух: откат курсора к ней догоняет всё, что могло
 * пролететь мимо, пока летела любая из половин.
 */
export async function pageAround(
  conversationId: string,
  seq: number,
  signal: AbortSignal,
): Promise<FeedWindow> {
  const [older, newer] = await Promise.all([
    api.messages(conversationId, { limit: FEED_PAGE, before: seq + 1, patient: true, signal }),
    api.messages(conversationId, { limit: FEED_PAGE, after: seq, patient: true, signal }),
  ]);
  return {
    items: [...older.items, ...newer.items],
    hasOlder: older.hasMore,
    hasNewer: newer.hasMore,
    head: Math.min(older.head, newer.head),
  };
}

/** Последняя страница — лента в конце. */
export async function pageLatest(conversationId: string, signal: AbortSignal): Promise<FeedWindow> {
  const page = await api.messages(conversationId, { limit: FEED_PAGE, signal });
  return { items: page.items, hasOlder: page.hasMore, hasNewer: false, head: page.head };
}
