import type { Message, SyncLine } from "./api.js";
import { type Local, merge, mergePinned, ofRoom } from "./feed.js";

/**
 * Что происходит с лентой — одна чистая функция (task-098, Д-10).
 *
 * ⚠️ КОМАНДЫ, А НЕ УСТАНОВЩИК. Раньше ленту меняли двенадцать мест через
 * `setMessages`, и отдать её в соседний хук значило отдать установщик —
 * связь хуже той, от которой уходили. Теперь хук говорит, что случилось
 * («черновик ушёл», «пришла страница»), а как лента от этого меняется,
 * знает только эта функция. Её проверки не требуют ни браузера, ни стека.
 */

export interface FeedState {
  /** Реплики, в том числе черновики этой вкладки. */
  messages: Local[];
  /** Закреплённое открытого разговора, свежее сверху. */
  pinned: Message[];
  hasOlder: boolean;
}

export const emptyFeed: FeedState = { messages: [], pinned: [], hasOlder: false };

export type FeedCommand =
  /** Пришла первая страница разговора. */
  | { type: "loaded"; conversationId: string; items: Message[]; hasMore: boolean }
  /** Пришли строки догона или события. `keep` — окно ленты, если человек внизу. */
  | { type: "arrived"; lines: SyncLine[]; openId: string | null; keep?: number | undefined }
  /** Долистали назад. */
  | { type: "older"; items: Message[]; hasMore: boolean }
  /** Своя запись вернулась ответом (пересылка в открытый разговор). */
  | { type: "added"; items: Message[] }
  | { type: "drafted"; draft: Local }
  | { type: "sent"; clientMsgId: string; message: Message }
  | { type: "notSent"; clientMsgId: string }
  | { type: "pinMarked"; messageId: string; pinnedAt: string | null }
  | { type: "edited"; message: Message }
  | { type: "removed"; messageId: string }
  | { type: "pinnedLoaded"; items: Message[] };

export function feedState(state: FeedState, command: FeedCommand): FeedState {
  switch (command.type) {
    case "loaded": {
      /**
       * ⚠️ ОТВЕТ НА ЗАГРУЗКУ ВЛИВАЕТСЯ В ЛЕНТУ, А НЕ ПОДМЕНЯЕТ ЕЁ. В только что
       * заведённом канале человек успевает отправить первое сообщение раньше,
       * чем долетит ответ на загрузку, — прямая подстановка стирала показанное.
       * Из ленты уходит только ЧУЖОЕ — оставшееся от прошлого разговора.
       */
      const own = state.messages.filter((one) => one.conversationId === command.conversationId);
      return {
        ...state,
        messages: own.length === 0 ? command.items : merge(own, command.items),
        hasOlder: command.hasMore,
      };
    }
    case "arrived":
      return {
        ...state,
        messages: merge(state.messages, ofRoom(command.lines, command.openId), command.keep),
        pinned: mergePinned(state.pinned, command.lines, command.openId),
      };
    case "older":
      return {
        ...state,
        messages: merge(state.messages, command.items),
        hasOlder: command.hasMore,
      };
    case "added":
      return { ...state, messages: merge(state.messages, command.items) };
    default:
      return ownChange(state, command);
  }
}

/** Команды о своих действиях над репликами. */
function ownChange(state: FeedState, command: FeedCommand): FeedState {
  switch (command.type) {
    case "drafted":
      return { ...state, messages: [...state.messages, command.draft] };
    case "sent":
      // Черновик заменяется настоящей записью: держать обе — однажды показать обе.
      return {
        ...state,
        messages: merge(
          state.messages.filter((one) => one.id !== command.clientMsgId),
          [command.message],
        ),
      };
    case "notSent":
      return {
        ...state,
        messages: state.messages.map((one) =>
          one.id === command.clientMsgId ? { ...one, state: "не ушло" } : one,
        ),
      };
    case "pinMarked":
      return {
        ...state,
        messages: state.messages.map((one) =>
          one.id === command.messageId ? { ...one, pinnedAt: command.pinnedAt } : one,
        ),
      };
    case "edited":
      return {
        ...state,
        messages: state.messages.map((one) =>
          one.id === command.message.id ? command.message : one,
        ),
      };
    case "removed":
      // Цитаты на удалённую гаснут здесь же: иначе чужие реплики показывали бы
      // текст удалённого сообщения до перезагрузки.
      return {
        ...state,
        messages: state.messages
          .filter((one) => one.id !== command.messageId)
          .map((one) => (one.replyTo?.id === command.messageId ? { ...one, replyTo: null } : one)),
        pinned: state.pinned.filter((one) => one.id !== command.messageId),
      };
    case "pinnedLoaded":
      return { ...state, pinned: command.items };
    default:
      return state;
  }
}
