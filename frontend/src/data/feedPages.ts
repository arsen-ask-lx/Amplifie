import { api, type Message } from "./api.js";
import { inWindow } from "./feed.js";

/**
 * Страницы ленты разговора: сколько брать и как открыть ленту вокруг
 * реплики (task-098 — вынесено из `useChat`; task-099 — лента с двумя краями).
 */

export const FEED_PAGE = 50;

/**
 * Нужна ли новая страница ленты — или на экране уже то, что просят.
 *
 * ⚠️ ОДНО МЕСТО НА ВСЕ ПРИЧИНЫ НЕ ГРУЗИТЬ. Их три, и каждая появилась
 * из своего мигания:
 *   • ТОТ ЖЕ ЧАТ В КОНЦЕ (task-020): нажатие на «Чат» ведёт на «/», адрес
 *     успевает сходить в пустоту и вернуться — грузить нечего;
 *   • НЕ В КОНЦЕ (task-099): «назад» и щелчок по чату в панели обязаны
 *     показать конец, поэтому давнее окно перезагружается;
 *   • НОМЕР УЖЕ В ОКНЕ (task-106): ход стрелками по попаданиям поиска —
 *     это прокрутка и подсветка, а не запрос. Прежде каждая стрелка
 *     стоила загрузки окна и полной перерисовки ленты.
 */
export function needsPage(input: {
  /** Чья лента на экране сейчас. */
  shown: string | null;
  /** Какой чат открыт адресом. */
  currentId: string;
  /** Номер из адреса: переход по цитате или попаданию. `null` — просто чат. */
  wanted: number | null;
  /** Лента открыта не в конце — за верхним краем есть новее. */
  hasNewer: boolean;
  /** Что сейчас в ленте. */
  messages: Message[];
}): boolean {
  const { shown, currentId, wanted, hasNewer, messages } = input;
  if (shown !== currentId) return true;
  if (wanted === null) return hasNewer;
  return !inWindow(messages, wanted);
}

/** Страница ленты вместе с тем, что за её краями. */
export interface FeedWindow {
  items: Message[];
  /**
   * Докуда человек дочитал этот чат (task-107). Есть только у окна, открытого
   * «на непрочитанном»: по нему лента ставит черту и знает, куда встать.
   */
  readSeq?: number;
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

/**
 * Лента так, как её открывает человек: на первом непрочитанном (task-107).
 *
 * ⚠️ РЕШАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Клиенту пришлось бы сперва спросить отметку
 * прочтения, потом ленту — лишний круг на каждое открытие чата, — и правило
 * «первое непрочитанное» жило бы в двух местах. Непрочитанного нет — ответ
 * тот же, что у `pageLatest`.
 *
 * `readSeq` приходит вместе со страницей: черту рисует лента, а не строка
 * панели, которой у чата вне первой порции может ещё не быть (Д-51).
 */
export async function pageUnread(conversationId: string, signal: AbortSignal): Promise<FeedWindow> {
  const page = await api.messages(conversationId, { limit: FEED_PAGE, around: "unread", signal });
  return {
    items: page.items,
    hasOlder: page.hasMore,
    hasNewer: page.hasNewer ?? false,
    head: page.head,
    ...(page.readSeq === undefined ? {} : { readSeq: page.readSeq }),
  };
}
