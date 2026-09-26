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
  /** Закреплённое, свежее сверху. Чьё оно — в `pinnedFor`. */
  pinned: Message[];
  /**
   * Чьё закреплённое лежит в `pinned` (Д-59).
   *
   * ⚠️ БЕЗ ХОЗЯИНА ПОЛОСКА ВРАЛА. Закреплённое одно на вкладку, и при переходе
   * над новой лентой висело закреплённое покинутого чата — пока не приедет
   * ответ. На стенде, рвавшем соединения, ответ опаздывал, и владелец видел
   * закреплённое «gbfd» в «123qwe» надолго. Показывается только своё.
   */
  pinnedFor: string | null;
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
  /**
   * Срезы чатов, где человек уже был (task-114) — чтобы возврат показывал
   * переписку в том же кадре, а не пустое место на время ответа сервера.
   *
   * ⚠️ СРЕЗ ЦЕЛИКОМ, А НЕ ОДНИ РЕПЛИКИ. `hasOlder`, `hasNewer` и `readSeq`
   * — по одному значению на вкладку, и в миг показа снимка они принадлежат
   * ПОКИНУТОМУ чату. Положи в снимок только реплики — и возврат в дочитанный
   * чат нарисует черту «Непрочитанные» над всей перепиской, взяв `readSeq`
   * соседа (у пустого чата это ноль). Поймано разбором критика, не прогоном.
   *
   * ⚠️ ПОРЯДОК КЛЮЧЕЙ — ПОРЯДОК СВЕЖЕСТИ. Показанный снимок переписывается
   * заново и уезжает в конец; вытесняется первый. Тот же приём, что у отметок
   * подтверждённых сессий на сервере: отдельного поля с временем не нужно.
   */
  snapshots: Record<string, Snapshot>;
  /**
   * Закреплённое чатов, где уже были — отдельно от снимков ленты.
   *
   * ⚠️ СНИМОК ЛЕНТЫ ПОКАЗЫВАЕТСЯ НЕ ВСЕГДА, А ЗАКРЕПЛЁННОЕ — ВСЕГДА. Снимок
   * ленты берётся только у дочитанного чата (task-114); у чата с новым
   * лента едет с сервера, и закреплённое ехало вместе с ней — полоска
   * выскакивала позже самого чата (владелец 26.09: «мерцает при
   * переключении»). Закреплённое меняется редко: показать прежнее до ответа
   * честно, ответ его заменит.
   */
  pinnedSeen: Record<string, Message[]>;
}

/** Что помним про чат, из которого ушли. Все четыре поля ленты, не только её. */
export interface Snapshot {
  messages: Message[];
  /** Закреплённое этого чата — возврат показывает его сразу, своё (Д-59). */
  pinned: Message[];
  hasOlder: boolean;
  hasNewer: boolean;
  readSeq: number | null;
}

/**
 * Сколько чатов помним. Восемь — не «вышел и вернулся», а обычное хождение
 * по проекту: смета → договор → подрядчик → обратно в смету.
 */
const SNAPSHOTS = 8;

/**
 * Сколько реплик кладём в снимок. Полного окна (300) не нужно: снимок живёт
 * до ответа сервера, а показывается его конец.
 */
const SNAPSHOT = 50;

/** Сколько чатов помнит закреплённое: список короткий, память дешёвая. */
const PINNED_SEEN = 16;

/** Запомнить закреплённое чата; самый давний вытесняется. Порядок ключей — свежесть. */
function pinnedRemembered(seen: Record<string, Message[]>, id: string, items: Message[]) {
  const { [id]: _was, ...rest } = seen;
  const kept = Object.entries(rest).slice(-(PINNED_SEEN - 1));
  return { ...Object.fromEntries(kept), [id]: items };
}

export const emptyFeed: FeedState = {
  messages: [],
  pinned: [],
  pinnedFor: null,
  hasOlder: false,
  hasNewer: false,
  readSeq: null,
  snapshots: {},
  pinnedSeen: {},
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
  /** Вернулись в чат, где уже были: показать срез из памяти до ответа (task-114). */
  | { type: "restored"; conversationId: string }
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
  | { type: "pinnedLoaded"; conversationId: string | null; items: Message[] }
  /** Перешли в чат: показать его закреплённое из памяти до ответа сервера. */
  | { type: "pinnedRecalled"; conversationId: string };

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
        /**
         * ⚠️ СТРАНИЦА — ПРАВДА В СВОЁМ ДИАПАЗОНЕ (task-114). `merge` умеет
         * убирать реплику только по надгробию: отсутствия реплики в ответе
         * он не читает. Пока `own` был пуст при переходе, это было незаметно —
         * страница подменяла ленту целиком. Со снимком `own` не пуст, и без
         * этого правила реплика, удалённая за время отсутствия, пережила бы
         * слияние и осталась на экране до перезагрузки.
         */
        messages: joins ? merge(truthOf(own, command.items), command.items) : command.items,
        hasOlder: command.hasMore,
        hasNewer,
        readSeq: command.readSeq ?? null,
        snapshots: remembered(state, command.conversationId),
      };
    }
    case "restored": {
      /**
       * ⚠️ СНАЧАЛА ЗАПОМНИТЬ ПОКИНУТЫЙ, ПОТОМ ПОКАЗАТЬ СРЕЗ, И ПОРЯДОК ЗДЕСЬ
       * НЕ УКРАШЕНИЕ. Снимок снимается по тому, чья лента лежит сейчас,
       * а показ среза эту ленту подменяет: после него приходящая страница
       * застаёт «ухожу сам из себя» и не запоминает ничего. Снимок чата
       * тогда замирал навсегда на том, каким он был до ПЕРВОГО возврата.
       * Наружу выходило так: возврат показывал переписку недельной давности
       * и реплику, удалённую полминуты назад. Поймано признаком П-3.
       */
      const snapshots = remembered(state, command.conversationId);
      const kept = snapshots[command.conversationId];
      if (!kept) return { ...state, snapshots };
      const { [command.conversationId]: _shown, ...rest } = snapshots;
      return {
        ...state,
        messages: kept.messages,
        pinned: kept.pinned,
        pinnedFor: command.conversationId,
        hasOlder: kept.hasOlder,
        hasNewer: kept.hasNewer,
        readSeq: kept.readSeq,
        // Показанный снимок — снова самый свежий: вытеснится он последним.
        snapshots: { ...rest, [command.conversationId]: kept },
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
        pinned: livePinned(state, command.lines, command.openId),
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
      return {
        ...state,
        pinned: command.items,
        pinnedFor: command.conversationId,
        pinnedSeen:
          command.conversationId === null
            ? state.pinnedSeen
            : pinnedRemembered(state.pinnedSeen, command.conversationId, command.items),
      };
    case "pinnedRecalled": {
      // ⚠️ УХОДЯ, ЗАПОМНИТЬ ТО, ЧТО НА ЭКРАНЕ, А НЕ ТО, ЧТО ПРИШЛО ОТВЕТОМ.
      // Закрепили при открытом чате — пришло событием, ответа сервера
      // не было: в памяти остался бы пустой список (поймано сценарием).
      const seen =
        state.pinnedFor === null
          ? state.pinnedSeen
          : pinnedRemembered(state.pinnedSeen, state.pinnedFor, state.pinned);
      const known = seen[command.conversationId];
      return known
        ? { ...state, pinned: known, pinnedFor: command.conversationId, pinnedSeen: seen }
        : { ...state, pinnedSeen: seen };
    }
    default:
      return state;
  }
}

/**
 * Что из ленты переживает пришедшую страницу.
 *
 * ⚠️ РЕЖЕМ СТРОГО ВНУТРИ ДИАПАЗОНА СТРАНИЦЫ, И ЭТО ГЛАВНОЕ. Страница
 * отвечает на вопрос «что сейчас в этом отрезке номеров» — значит внутри
 * отрезка её слово последнее, а за краями она ничего не утверждает.
 * Отрезать по краям значило бы стирать с экрана свежую реплику, приехавшую
 * живой, пока страница летела, и давнее окно, догруженное листанием.
 *
 * Пустая страница диапазона не задаёт и потому не режет ничего.
 */
function truthOf(current: Message[], page: Message[]): Message[] {
  if (page.length === 0) return current;
  const seqs = page.map((one) => one.seq);
  const low = Math.min(...seqs);
  const high = Math.max(...seqs);
  const came = new Set(page.map((one) => one.id));
  return current.filter((one) => one.seq < low || one.seq > high || came.has(one.id));
}

/**
 * Положить в снимки чат, из которого уходим.
 *
 * ⚠️ РЕШАЕТСЯ ПО ТОМУ, ЧТО В ЛЕНТЕ, а не по тому, что нам сказали: команда
 * знает только, чья страница пришла. Лента же держит ровно один чат, и его
 * идентификатор — у первой реплики.
 */
/**
 * Живое вливается только в закреплённое открытого чата (Д-59): чужой список
 * дополнять нечем — его сменит ответ сервера про закреплённое нового чата.
 */
function livePinned(state: FeedState, lines: SyncLine[], openId: string | null): Message[] {
  return state.pinnedFor === openId ? mergePinned(state.pinned, lines, openId) : state.pinned;
}

function remembered(state: FeedState, arriving: string): Record<string, Snapshot> {
  const leaving = state.messages[0]?.conversationId;
  if (!leaving || leaving === arriving) return state.snapshots;

  const { [leaving]: _was, ...rest } = state.snapshots;
  const kept = state.messages.filter((one) => one.conversationId === leaving).slice(-SNAPSHOT);
  const snapshots: Record<string, Snapshot> = {
    ...rest,
    [leaving]: {
      messages: kept,
      pinned: state.pinnedFor === leaving ? state.pinned : [],
      hasOlder: state.hasOlder,
      hasNewer: state.hasNewer,
      /**
       * ⚠️ «ПРОЧИТАНО ВСЁ, ЧТО ЗДЕСЬ ЛЕЖИТ», А НЕ `state.readSeq`. Отметка
       * в ленте ЗАМИРАЕТ НА ОТКРЫТИИ — в этом весь смысл черты (task-107), —
       * и к мигу ухода она устарела на всё, что человек прочёл глазами.
       * Положи её в снимок как есть — и возврат в дочитанный чат нарисует
       * черту «Непрочитанные» над всей перепиской. Поймано живым сценарием
       * `switch-instant.spec.ts`, а не рассуждением.
       *
       * Число честное: снимок показывается ТОЛЬКО у чата, где сервер
       * насчитал ноль непрочитанного, — значит всё, что в нём лежит,
       * и правда прочитано.
       */
      readSeq: kept.at(-1)?.seq ?? state.readSeq,
    },
  };

  // Вытесняется тот, который дольше всех не показывали: порядок ключей —
  // порядок свежести, значит лишний всегда первый.
  const keys = Object.keys(snapshots);
  for (const old of keys.slice(0, Math.max(0, keys.length - SNAPSHOTS))) delete snapshots[old];
  return snapshots;
}
