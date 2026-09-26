/**
 * Команды ленты (task-098). По проверке на команду: каждая делает ровно то,
 * что прежде делал соответствующий `setMessages` в `useChat`.
 */
import { describe, expect, it } from "vitest";
import type { Message } from "./api.js";
import type { Local } from "./feed.js";
import { emptyFeed, type FeedState, feedState } from "./feedState.js";

const ROOM = "room-a";
const OTHER = "room-b";

function msg(id: string, seq: number, edit: Partial<Message> = {}): Message {
  return {
    id,
    clientMsgId: id,
    conversationId: ROOM,
    body: id,
    kind: "human",
    seq,
    createdAt: "2026-09-17T10:00:00.000Z",
    editedAt: null,
    pinnedAt: null,
    author: { id: "автор", name: "Автор", kind: "human" },
    replyTo: null,
    forwardedFrom: null,
    ...edit,
  };
}

const withMessages = (messages: Local[], rest: Partial<FeedState> = {}): FeedState => ({
  ...emptyFeed,
  messages,
  ...rest,
});

const ids = (state: FeedState) => state.messages.map((one) => one.id);

describe("команды ленты", () => {
  it("loaded: чужая лента уходит, своя сливается со страницей, hasOlder из ответа", () => {
    const state = withMessages([msg("чужая", 1, { conversationId: OTHER }), msg("своя", 5)]);
    const got = feedState(state, {
      type: "loaded",
      conversationId: ROOM,
      items: [msg("старая", 3)],
      hasMore: true,
    });
    expect([ids(got), got.hasOlder]).toEqual([["старая", "своя"], true]);
  });

  it("arrived: только открытый разговор, окно режет сверху, закреплённое обновляется", () => {
    const state = withMessages([msg("a", 1), msg("b", 2)], { pinnedFor: ROOM });
    const got = feedState(state, {
      type: "arrived",
      lines: [
        msg("c", 3, { pinnedAt: "2026-09-17T11:00:00.000Z" }),
        msg("x", 4, { conversationId: OTHER }),
      ],
      openId: ROOM,
      keep: 2,
    });
    expect([ids(got), got.pinned.map((one) => one.id)]).toEqual([["b", "c"], ["c"]]);
  });

  it("arrived: в закреплённое чужого чата живое не вливается (Д-59)", () => {
    // Полоска ещё держит закреплённое покинутого чата — ответ про новый
    // не приехал. Дополнять чужой список закреплением открытого нельзя.
    const state = withMessages([msg("a", 1)], { pinned: [msg("чужое", 9)], pinnedFor: OTHER });
    const got = feedState(state, {
      type: "arrived",
      lines: [msg("c", 3, { pinnedAt: "2026-09-17T11:00:00.000Z" })],
      openId: ROOM,
    });
    expect([got.pinned.map((one) => one.id), got.pinnedFor]).toEqual([["чужое"], OTHER]);
  });

  it("older: старое вливается без окна, hasOlder из ответа", () => {
    const got = feedState(withMessages([msg("b", 2)], { hasOlder: true }), {
      type: "older",
      items: [msg("a", 1)],
      hasMore: false,
    });
    expect([ids(got), got.hasOlder]).toEqual([["a", "b"], false]);
  });

  it("added: запись вливается по номеру", () => {
    const got = feedState(withMessages([msg("b", 2)]), { type: "added", items: [msg("a", 1)] });
    expect(ids(got)).toEqual(["a", "b"]);
  });

  it("sending в конце ленты — лента та же: черновик живёт в очереди, а не здесь (task-111)", () => {
    const state = withMessages([msg("a", 1)]);
    expect(feedState(state, { type: "sending" })).toBe(state);
  });

  it("pinMarked: меняется отметка только у этой реплики", () => {
    const got = feedState(withMessages([msg("a", 1), msg("b", 2)]), {
      type: "pinMarked",
      messageId: "b",
      pinnedAt: "2026-09-17T12:00:00.000Z",
    });
    expect(got.messages.map((one) => one.pinnedAt)).toEqual([null, "2026-09-17T12:00:00.000Z"]);
  });

  it("edited: реплика заменяется ответом сервера", () => {
    const got = feedState(withMessages([msg("a", 1)]), {
      type: "edited",
      message: msg("a", 1, { body: "поправлено" }),
    });
    expect(got.messages[0]?.body).toBe("поправлено");
  });

  it("removed: реплика уходит, цитаты на неё гаснут, из закреплённого тоже", () => {
    const quoted = msg("ответ", 2, {
      replyTo: { id: "a", seq: 1, author: "Автор", excerpt: "a" },
    });
    const got = feedState(withMessages([msg("a", 1), quoted], { pinned: [msg("a", 1)] }), {
      type: "removed",
      messageId: "a",
    });
    expect([ids(got), got.messages[0]?.replyTo, got.pinned]).toEqual([["ответ"], null, []]);
  });

  it("pinnedLoaded: закреплённое заменяется целиком", () => {
    const got = feedState(withMessages([], { pinned: [msg("старое", 1)] }), {
      type: "pinnedLoaded",
      conversationId: OTHER,
      items: [msg("новое", 2)],
    });
    expect(got.pinned.map((one) => one.id)).toEqual(["новое"]);
    // Закреплённое помнит, чьё оно: чужое полоска не покажет (Д-59).
    expect(got.pinnedFor).toBe(OTHER);
  });
});

/**
 * ЛЕНТА НЕ В КОНЦЕ (task-099). Переход к давнему сообщению открывает отрезок
 * вокруг него; живое к этому отрезку прилипать не должно.
 */
describe("лента не в конце", () => {
  const around = () =>
    withMessages([msg("десятая", 10), msg("одиннадцатая", 11)], { hasOlder: true, hasNewer: true });

  it("loaded: страница не в конце заменяет ленту в конце целиком — дыры нет", () => {
    const got = feedState(withMessages([msg("свежая", 600)]), {
      type: "loaded",
      conversationId: ROOM,
      items: [msg("десятая", 10)],
      hasMore: true,
      hasNewer: true,
    });
    expect([ids(got), got.hasNewer]).toEqual([["десятая"], true]);
  });

  it("loaded: страница в конце поверх ленты не в конце — замена, а не склейка", () => {
    const got = feedState(around(), {
      type: "loaded",
      conversationId: ROOM,
      items: [msg("свежая", 600)],
      hasMore: true,
    });
    expect([ids(got), got.hasNewer]).toEqual([["свежая"], false]);
  });

  it("arrived: новая реплика за краем не прилипает, правка показанной доезжает", () => {
    const got = feedState(around(), {
      type: "arrived",
      lines: [msg("свежая", 601), msg("десятая", 10, { body: "поправлено" })],
      openId: ROOM,
      keep: 1,
    });
    expect([ids(got), got.messages[0]?.body]).toEqual([["десятая", "одиннадцатая"], "поправлено"]);
  });

  it("newer: долистали до конца — край снят, дальше живое вливается", () => {
    const reached = feedState(around(), {
      type: "newer",
      items: [msg("двенадцатая", 12)],
      hasMore: false,
    });
    const live = feedState(reached, { type: "arrived", lines: [msg("свежая", 13)], openId: ROOM });
    expect([reached.hasNewer, ids(live)]).toEqual([
      false,
      ["десятая", "одиннадцатая", "двенадцатая", "свежая"],
    ]);
  });

  it("sending: своя отправка из давнего — лента пуста до загрузки конца, край снят", () => {
    const got = feedState(around(), { type: "sending" });
    expect([ids(got), got.hasNewer, got.hasOlder]).toEqual([[], false, true]);
  });

  it("added: записанная реплика не в конце ленты не вклеивается за край", () => {
    const got = feedState(around(), {
      type: "added",
      items: [msg("настоящая", 700, { clientMsgId: "черновик" })],
    });
    expect(ids(got)).toEqual(["десятая", "одиннадцатая"]);
  });
});

/**
 * Снимок чата и правда страницы (task-114).
 *
 * ⚠️ ДВА РАЗНЫХ СВОЙСТВА, И ОНИ НУЖНЫ ДРУГ ДРУГУ. Снимок показывается до ответа
 * сервера — значит он может устареть. Правда страницы — то, что этот ответ
 * его исправляет: реплика, которой в пришедшей странице нет, с экрана уходит.
 * Без второго снимок превращается в место, где удалённое живёт вечно.
 */
describe("снимок чата", () => {
  const snapshotOf = (state: FeedState, room: string) => state.snapshots[room];

  it("страница — правда в своём диапазоне: пропавшая в ней реплика уходит", () => {
    const state = withMessages([msg("a", 1), msg("b", 2), msg("c", 3)]);
    const got = feedState(state, {
      type: "loaded",
      conversationId: ROOM,
      items: [msg("a", 1), msg("c", 3)],
      hasMore: false,
    });
    expect(ids(got), "b лежит внутри [1..3] и в странице её нет").toEqual(["a", "c"]);
  });

  it("за краями страницы ничего не режется: свежее сверху и давнее снизу целы", () => {
    // «свежая» приехала живой, пока страница летела: её номер выше верхнего
    // края. «давняя» осталась от прошлой догрузки: ниже нижнего края.
    const state = withMessages([msg("давняя", 1), msg("b", 5), msg("свежая", 9)]);
    const got = feedState(state, {
      type: "loaded",
      conversationId: ROOM,
      items: [msg("b", 5), msg("d", 6)],
      hasMore: false,
    });
    expect(ids(got)).toEqual(["давняя", "b", "d", "свежая"]);
  });

  it("уход из чата кладёт срез целиком, а не одни реплики", () => {
    const state = withMessages([msg("a", 1), msg("b", 2)], {
      pinned: [msg("a", 1)],
      pinnedFor: ROOM,
      hasOlder: true,
      hasNewer: false,
      readSeq: 2,
    });
    const got = feedState(state, {
      type: "loaded",
      conversationId: OTHER,
      items: [msg("чужая", 7, { conversationId: OTHER })],
      hasMore: false,
    });
    expect(snapshotOf(got, ROOM)).toEqual({
      messages: [msg("a", 1), msg("b", 2)],
      // Закреплённое уходит в снимок вместе с лентой: возврат покажет своё (Д-59).
      pinned: [msg("a", 1)],
      hasOlder: true,
      hasNewer: false,
      readSeq: 2,
    });
  });

  it("устаревшая отметка прочтения в снимок не попадает", () => {
    // `readSeq` в ленте замирает на открытии: тут он остался нулём с того
    // мига, когда чат открыли пустым, а человек с тех пор прочёл обе реплики.
    const state = withMessages([msg("a", 1), msg("b", 2)], { readSeq: 0 });
    const got = feedState(state, {
      type: "loaded",
      conversationId: OTHER,
      items: [msg("чужая", 7, { conversationId: OTHER })],
      hasMore: false,
    });
    expect(snapshotOf(got, ROOM)?.readSeq, "черта встанет над всей перепиской").toBe(2);
  });

  it("возврат восстанавливает все четыре поля, а не только ленту", () => {
    const left = feedState(
      withMessages([msg("a", 1), msg("b", 2)], { hasOlder: true, hasNewer: false, readSeq: 2 }),
      {
        type: "loaded",
        conversationId: OTHER,
        items: [msg("чужая", 7, { conversationId: OTHER })],
        hasMore: true,
      },
    );
    const back = feedState(left, { type: "restored", conversationId: ROOM });
    expect([ids(back), back.hasOlder, back.hasNewer, back.readSeq]).toEqual([
      ["a", "b"],
      true,
      false,
      2,
    ]);
  });

  it("вход срезом тоже запоминает покинутый чат, иначе его снимок замирает навсегда", () => {
    // ⚠️ НАЙДЕНО ПРИЗНАКОМ П-3, А НЕ РАЗБОРОМ. Снимок покинутого брался
    // на приходе страницы — по тому, чья лента лежит сейчас. Но после
    // показа среза в ленте лежит уже НОВЫЙ чат, и страница застаёт
    // «ухожу сам из себя»: снимок покинутого не обновлялся ни разу.
    // Наружу это выходило так: возврат показывал переписку недельной
    // давности, а живьём — реплику, удалённую полминуты назад.
    const state = withMessages([msg("a", 1), msg("b", 2)], {
      snapshots: {
        [OTHER]: {
          messages: [msg("чужая", 7, { conversationId: OTHER })],
          pinned: [],
          hasOlder: false,
          hasNewer: false,
          readSeq: 7,
        },
      },
    });
    const back = feedState(state, { type: "restored", conversationId: OTHER });
    expect(ids(back), "срез соседа показан").toEqual(["чужая"]);
    expect(
      snapshotOf(back, ROOM)?.messages.map((one) => one.id),
      "покинутый забыт",
    ).toEqual(["a", "b"]);
  });

  it("девятый снимок вытесняет тот, который дольше всех не показывали", () => {
    let state: FeedState = emptyFeed;
    // Десять чатов подряд: каждый раз уходим в следующий, и предыдущий
    // ложится в снимки. Снимков обязано остаться восемь, и уйти обязан
    // самый давний — первый.
    for (let n = 1; n <= 10; n++) {
      state = feedState(state, {
        type: "loaded",
        conversationId: `чат-${n}`,
        items: [msg(`реплика-${n}`, n, { conversationId: `чат-${n}` })],
        hasMore: false,
      });
    }
    expect(Object.keys(state.snapshots)).toEqual([
      "чат-2",
      "чат-3",
      "чат-4",
      "чат-5",
      "чат-6",
      "чат-7",
      "чат-8",
      "чат-9",
    ]);
  });
});
