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
    const state = withMessages([msg("a", 1), msg("b", 2)]);
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

  it("drafted и sent: черновик встаёт в конец и вытесняется записанной", () => {
    const drafted = feedState(withMessages([msg("a", 1)]), {
      type: "drafted",
      draft: { ...msg("черновик", 1.5), state: "идёт" },
    });
    const sent = feedState(drafted, {
      type: "sent",
      clientMsgId: "черновик",
      message: msg("настоящая", 2, { clientMsgId: "черновик" }),
    });
    expect([ids(drafted), ids(sent)]).toEqual([
      ["a", "черновик"],
      ["a", "настоящая"],
    ]);
  });

  it("notSent: помечается та самая реплика", () => {
    const got = feedState(withMessages([{ ...msg("черновик", 1), state: "идёт" }, msg("b", 2)]), {
      type: "notSent",
      clientMsgId: "черновик",
    });
    expect(got.messages.map((one) => ("state" in one ? one.state : undefined))).toEqual([
      "не ушло",
      undefined,
    ]);
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
      items: [msg("новое", 2)],
    });
    expect(got.pinned.map((one) => one.id)).toEqual(["новое"]);
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

  it("drafted: своя отправка из старого — лента из черновика, край снят", () => {
    const got = feedState(around(), {
      type: "drafted",
      draft: { ...msg("черновик", 11.5), state: "идёт" },
    });
    expect([ids(got), got.hasNewer, got.hasOlder]).toEqual([["черновик"], false, true]);
  });

  it("sent: записанная реплика не в конце ленты не вклеивается за край", () => {
    const got = feedState(around(), {
      type: "sent",
      clientMsgId: "черновик",
      message: msg("настоящая", 700, { clientMsgId: "черновик" }),
    });
    expect(ids(got)).toEqual(["десятая", "одиннадцатая"]);
  });
});
