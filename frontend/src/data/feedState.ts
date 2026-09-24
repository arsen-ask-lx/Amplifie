import type { Message, SyncLine } from "./api.js";
import { type Edges, inside, merge, mergePinned, ofRoom } from "./feed.js";

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
  /**
   * Записанные реплики. Неотправленное живёт в очереди вкладки и ложится
   * поверх при показе (`sendQueue`, task-111): лента теряет чужие чаты
   * при каждой загрузке, а черновик терять нельзя.
   */
  messages: Message[];
  /** Закреплённое открытого разговора, свежее сверху. */
  pinned: Message[];
  hasOlder: boolean;
  /**
   * За верхним краем есть незагруженное — лента открыта не в конце
   * (task-099, переход к давнему сообщению). `false` — отрезок доходит
   * до живого конца, и живое в него вливается.
   */
  hasNewer: boolean;
  /**
   * Докуда человек дочитал этот чат — из ответа ленты (task-107).
   * `null` — лента открыта не «на непрочитанном» (переход по цитате,
   * поиск, догрузка): черту в этом случае рисовать не по чему.
   *
   * ⚠️ ЗАМИРАЕТ НА ОТКРЫТИИ, и это весь смысл черты: она отвечает
   * на вопрос «докуда я дочитал», а не «что нового прямо сейчас».
   */
  readSeq: number | null;
}

export const emptyFeed: FeedState = {
  messages: [],
  pinned: [],
  hasOlder: false,
  hasNewer: false,
  readSeq: null,
};

const edgesOf = (state: FeedState): Edges => ({ older: state.hasOlder, newer: state.hasNewer });

export type FeedCommand =
  /**
   * Пришла страница разговора: последняя либо вокруг номера.
   * `hasMore` — есть ли старше, `hasNewer` — есть ли новее (нет поля — конец).
   */
  | {
      type: "loaded";
      conversationId: string;
      items: Message[];
      hasMore: boolean;
      hasNewer?: boolean;
      /** Докуда прочитано — только у окна «на непрочитанном» (task-107). */
      readSeq?: number;
    }
  /** Пришли строки догона или события. `keep` — окно ленты, если человек внизу. */
  | { type: "arrived"; lines: SyncLine[]; openId: string | null; keep?: number | undefined }
  /** Долистали назад. */
  | { type: "older"; items: Message[]; hasMore: boolean }
  /** Долистали вперёд, к живому концу (task-099). */
  | { type: "newer"; items: Message[]; hasMore: boolean }
  /** Своя запись вернулась ответом: отправка из очереди, пересылка в открытый разговор. */
  | { type: "added"; items: Message[] }
  /** Своя реплика ушла в очередь (task-111). */
  | { type: "sending" }
  | { type: "pinMarked"; messageId: string; pinnedAt: string | null }
  | { type: "edited"; message: Message }
  | { type: "removed"; messageId: string }
  | { type: "pinnedLoaded"; items: Message[] };

export function feedState(state: FeedState, command: FeedCommand): FeedState {
  switch (command.type) {
    case "loaded": {
      const hasNewer = command.hasNewer ?? false;
      /**
       * ⚠️ ОТВЕТ НА ЗАГРУЗКУ ВЛИВАЕТСЯ В ЛЕНТУ, А НЕ ПОДМЕНЯЕТ ЕЁ. В только что
       * заведённом канале человек успевает отправить первое сообщение раньше,
       * чем долетит ответ на загрузку, — прямая подстановка стирала показанное.
       * Из ленты уходит только ЧУЖОЕ — оставшееся от прошлого разговора.
       *
       * ⚠️ НО ТОЛЬКО КОГДА И ЛЕНТА, И СТРАНИЦА В КОНЦЕ (task-099). Решает
       * пришедшая страница, а не прежнее состояние: окно вокруг давнего
       * сообщения, слитое с концом, — это год истории, склеенный через дыру.
       */
      const own = state.messages.filter((one) => one.conversationId === command.conversationId);
      const joins = !hasNewer && !state.hasNewer && own.length > 0;
      return {
        ...state,
        messages: joins ? merge(own, command.items) : command.items,
        hasOlder: command.hasMore,
        hasNewer,
        readSeq: command.readSeq ?? null,
      };
    }
    case "arrived":
      return {
        ...state,
        messages: merge(
          state.messages,
          inside(state.messages, ofRoom(command.lines, command.openId), edgesOf(state)),
          // Окно режет сверху только в конце: не в конце живое не вливается,
          // а резать отрезок, который человек читает, — терять его.
          state.hasNewer ? undefined : command.keep,
        ),
        pinned: mergePinned(state.pinned, command.lines, command.openId),
      };
    case "older":
      return {
        ...state,
        messages: merge(state.messages, command.items),
        hasOlder: command.hasMore,
      };
    case "newer":
      return {
        ...state,
        messages: merge(state.messages, command.items),
        hasNewer: command.hasMore,
      };
    case "added":
      return {
        ...state,
        messages: merge(state.messages, inside(state.messages, command.items, edgesOf(state))),
      };
    default:
      return ownChange(state, command);
  }
}

/** Команды о своих действиях над репликами. */
function ownChange(state: FeedState, command: FeedCommand): FeedState {
  switch (command.type) {
    case "sending":
      // Своя отправка из давнего уводит в конец, как у Телеграма: лента пуста
      // до загрузки конца, которую зовёт хук, а черновик кладёт поверх очередь.
      // В конце ленте меняться не из-за чего — та же ссылка, без перерисовки.
      if (!state.hasNewer) return state;
      return { ...state, messages: [], hasOlder: true, hasNewer: false };
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
