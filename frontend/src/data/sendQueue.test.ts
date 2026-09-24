/**
 * Очередь отправки (task-111). Написан ДО кода и обязан быть красным.
 *
 * Часы и сон подставные: срок сервера в семь секунд проверяется числом,
 * а не ожиданием. Ответы сервера — по сценарию каждой проверки.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../shared/failure.js";
import type { Message } from "./api.js";
import type { Local } from "./feed.js";
import { type Outgoing, type SendEvents, SendQueue, withDrafts } from "./sendQueue.js";

const ROOM = "room-a";
const OTHER = "room-b";

/** Судьба попытки: номер попытки этой реплики и подставные часы в её миг. */
type Answer = (item: Outgoing, attempt: number, clock: number) => Promise<Message>;

/** Запись, которую вернул бы сервер: настоящий `id`, номер, тот же ключ. */
function written(
  item: Pick<Outgoing, "clientMsgId" | "conversationId" | "body">,
  seq: number,
): Message {
  return {
    id: `записана-${item.clientMsgId}`,
    clientMsgId: item.clientMsgId,
    conversationId: item.conversationId,
    body: item.body,
    kind: "human",
    seq,
    createdAt: "2026-09-22T10:00:00.000Z",
    editedAt: null,
    pinnedAt: null,
    author: { id: "я", name: "Я", kind: "human" },
    replyTo: null,
    forwardedFrom: null,
  };
}

function item(key: string, edit: Partial<Omit<Outgoing, "state">> = {}): Omit<Outgoing, "state"> {
  return {
    clientMsgId: key,
    conversationId: ROOM,
    body: key,
    replyTo: null,
    scope: "conversation",
    author: { id: "я", name: "Я", kind: "human" },
    createdAt: "2026-09-22T10:00:00.000Z",
    ...edit,
  };
}

const tooOften = (ms: number) => new ApiError(429, { error: "too_many_requests" }, ms);
const offline = () => new TypeError("Failed to fetch");
const ok = (one: Outgoing) => Promise.resolve(written(one, 1));

/** Дождаться, пока очередь сделает всё, что может сделать без внешнего события. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Очередь, замершая на сроке 429: реплика ушла, сервер попросил подождать,
 * и сон не кончится, пока тест не позовёт `wake`.
 *
 * Отдельным помощником, потому что двум проверкам — «очистили» и «отменили» —
 * нужна ровно эта середина, и списанная второй раз она разъезжается: первая
 * копия менялась, вторая нет, и красным становился не тот тест.
 */
async function sleeping(key: string) {
  let wake: () => void = () => undefined;
  const h = harness(() => Promise.reject(tooOften(60_000)), {
    sleep: () =>
      new Promise((resolve) => {
        wake = resolve;
      }),
  });
  h.queue.push(item(key));
  await settle();
  return { h, wake: () => wake() };
}

/** Отложенный ответ: тест сам решает, когда и чем он закончится. */
function later<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/**
 * Очередь с подставным сервером. `answer` решает судьбу каждой попытки;
 * `calls` — кто и когда (по подставным часам) уходил на сервер; `heard` —
 * что очередь рассказала экрану.
 */
function harness(
  answer: Answer,
  options: {
    sleep?: (ms: number) => Promise<void>;
    remove?: (messageId: string) => Promise<unknown>;
    ask?: (one: Outgoing) => Promise<unknown>;
  } = {},
) {
  let clock = 0;
  const calls: { key: string; at: number }[] = [];
  const attempts = new Map<string, number>();
  const slept: number[] = [];
  const asked: Outgoing[] = [];
  const removed: string[] = [];
  const queue = new SendQueue({
    send: (one) => {
      calls.push({ key: one.clientMsgId, at: clock });
      const attempt = attempts.get(one.clientMsgId) ?? 0;
      attempts.set(one.clientMsgId, attempt + 1);
      return answer(one, attempt, clock);
    },
    ask:
      options.ask ??
      (async (one) => {
        asked.push(one);
      }),
    remove:
      options.remove ??
      (async (messageId) => {
        removed.push(messageId);
      }),
    now: () => clock,
    random: () => 0.5,
    sleep:
      options.sleep ??
      (async (ms) => {
        slept.push(ms);
        clock += ms;
      }),
    limit: () => new AbortController().signal,
  });
  const heard: string[] = [];
  const events: SendEvents = {
    delivered: (one, message) => heard.push(`записана ${one.clientMsgId}→${message.seq}`),
    agentFailed: (one) => heard.push(`агент ${one.conversationId}`),
    sessionEnded: () => heard.push("сессии нет"),
  };
  queue.listen(events);
  const states = () => queue.current().map((one) => `${one.clientMsgId}:${one.state}`);
  return {
    queue,
    calls,
    slept,
    asked,
    removed,
    heard,
    states,
    keys: () => calls.map((one) => one.key),
  };
}

describe("очередь отправки", () => {
  it("по одной: вторая не уходит, пока первая в пути", async () => {
    const first = later<Message>();
    const h = harness((one) => (one.clientMsgId === "a" ? first.promise : ok(one)));
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    await settle();
    const whileFirstInFlight = h.keys();

    first.resolve(written(item("a"), 1));
    await settle();
    expect([whileFirstInFlight, h.keys(), h.states()]).toEqual([["a"], ["a", "b"], []]);
  });

  it("429: голова ждёт срока сервера, следующая не обгоняет её", async () => {
    const h = harness((one, attempt) =>
      one.clientMsgId === "a" && attempt === 0 ? Promise.reject(tooOften(7_000)) : ok(one),
    );
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    await settle();

    expect(h.keys()).toEqual(["a", "a", "b"]);
    // Разброс идёт поверх срока, а не вместо него (`nextDelay`).
    expect(h.calls[1]?.at).toBeGreaterThanOrEqual(7_000);
    expect(h.states()).toEqual([]);
  });

  it("отказ этой реплике не держит остальных: у неё «!», следующая уходит", async () => {
    const h = harness((one) =>
      one.clientMsgId === "a" ? Promise.reject(new ApiError(403, { error: "forbidden" })) : ok(one),
    );
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    await settle();

    expect([h.keys(), h.states()]).toEqual([["a", "b"], ["a:не ушло"]]);
  });

  it("сервер недоступен дольше терпения — «!» у головы и у всех ждущих, их не слали", async () => {
    const down = true;
    const h = harness((one) => (down ? Promise.reject(offline()) : ok(one)));
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    h.queue.push(item("c"));
    await settle();

    const tried = new Set(h.keys());
    expect([[...tried], h.states()]).toEqual([["a"], ["a:не ушло", "b:не ушло", "c:не ушло"]]);
    // Терпели не дольше срока загрузок экрана и не бросили раньше него.
    expect(h.slept.reduce((sum, ms) => sum + ms, 0)).toBe(30_000);
  });

  it("щелчок по «!» отправляет все не ушедшие, в порядке набора", async () => {
    let down = true;
    const h = harness((one) => (down ? Promise.reject(offline()) : ok(one)));
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    h.queue.push(item("c"));
    await settle();
    const before = h.calls.length;

    down = false;
    h.queue.retry();
    await settle();
    expect([h.keys().slice(before), h.states()]).toEqual([["a", "b", "c"], []]);
  });

  it("терпение считается от первой неудачи подряд: 429 его сбрасывает", async () => {
    // Сорок семь секунд по порогу, потом сеть пропадает на двадцать пять —
    // короче терпения. Считай оно от начала доставки, «!» встал бы на 30-й.
    const h = harness((one, attempt, clock) => {
      if (attempt === 0) return Promise.reject(tooOften(47_000));
      return clock < 47_500 + 25_000 ? Promise.reject(offline()) : ok(one);
    });
    const seen: string[] = [];
    h.queue.subscribe(() => seen.push(...h.states()));
    h.queue.push(item("a"));
    await settle();

    expect([h.states(), seen.includes("a:не ушло"), h.heard]).toEqual([
      [],
      false,
      ["записана a→1"],
    ]);
  });

  it("короткий сбой переживается сам: реплика уходит без «!»", async () => {
    const h = harness((one, attempt) => (attempt < 2 ? Promise.reject(offline()) : ok(one)));
    const seen: string[] = [];
    h.queue.subscribe(() => seen.push(...h.states()));
    h.queue.push(item("a"));
    await settle();

    expect([h.keys(), h.states(), seen.includes("a:не ушло")]).toEqual([
      ["a", "a", "a"],
      [],
      false,
    ]);
  });

  it("сессии нет — «!» у всех ждущих, дальше не шлём, экран узнаёт", async () => {
    const h = harness(() => Promise.reject(new ApiError(401, { error: "unauthorized" })));
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    await settle();

    expect([h.keys(), h.states(), h.heard]).toEqual([
      ["a"],
      ["a:не ушло", "b:не ушло"],
      ["сессии нет"],
    ]);
  });

  it("очистка во время ожидания 429 — после сна не уходит ничего", async () => {
    const { h, wake } = await sleeping("a");

    h.queue.clear();
    wake();
    await settle();
    expect([h.keys(), h.states()]).toEqual([["a"], []]);
  });

  it("записана: экран получает запись, агента зовут по чату и области реплики", async () => {
    const h = harness((one) => Promise.resolve(written(one, 7)));
    h.queue.push(item("a", { conversationId: OTHER, scope: "project" }));
    await settle();

    expect([h.heard, h.asked.map((one) => `${one.conversationId}/${one.scope}`)]).toEqual([
      ["записана a→7"],
      [`${OTHER}/project`],
    ]);
  });

  it("агент отказал — экран узнаёт, в каком чате; реплика при этом записана", async () => {
    const h = harness(ok, { ask: () => Promise.reject(new ApiError(503, { error: "no_model" })) });
    h.queue.push(item("a", { conversationId: OTHER }));
    await settle();

    expect([h.heard, h.states()]).toEqual([["записана a→1", `агент ${OTHER}`], []]);
  });
});

/**
 * Отмена (task-111, критик: «Удалить» у черновика шло на сервер 404, а через
 * минуту очередь отправляла то, что человек удалил).
 */
describe("не отправлять", () => {
  it("ждущая за головой не уходит никогда", async () => {
    const first = later<Message>();
    const h = harness((one) => (one.clientMsgId === "a" ? first.promise : ok(one)));
    h.queue.push(item("a"));
    h.queue.push(item("b"));
    await settle();

    h.queue.cancel("b");
    first.resolve(written(item("a"), 1));
    await settle();
    expect([h.keys(), h.states()]).toEqual([["a"], []]);
  });

  it("голова, ждущая срока по 429, после сна не уходит", async () => {
    const { h, wake } = await sleeping("a");

    h.queue.cancel("a");
    wake();
    await settle();
    expect([h.keys(), h.states(), h.heard]).toEqual([["a"], [], []]);
  });

  it("уже в пути и сервер записал — удаляется там же, агента не зовут", async () => {
    const flight = later<Message>();
    const h = harness(() => flight.promise);
    h.queue.push(item("a"));
    await settle();

    h.queue.cancel("a");
    flight.resolve(written(item("a"), 3));
    await settle();
    expect([h.removed, h.heard, h.asked, h.states()]).toEqual([["записана-a"], [], [], []]);
  });

  it("удалить записанную не вышло — экран видит её записанной, а не отменённой", async () => {
    const flight = later<Message>();
    const h = harness(() => flight.promise, { remove: () => Promise.reject(offline()) });
    h.queue.push(item("a"));
    await settle();

    h.queue.cancel("a");
    flight.resolve(written(item("a"), 3));
    await settle();
    expect(h.heard).toEqual(["записана a→3"]);
  });
});

/**
 * Лента с черновиками поверх записанного (task-111).
 *
 * Критик дважды: номер черновика целел — и черновик выдавал себя за
 * записанную реплику; номер у пачки был один — и лента не ехала за ней вниз.
 */
describe("withDrafts", () => {
  const feed = (...seqs: number[]): Local[] =>
    seqs.map((seq) =>
      written({ clientMsgId: `k${seq}`, conversationId: ROOM, body: `r${seq}` }, seq),
    );
  const waiting = (key: string, edit: Partial<Outgoing> = {}): Outgoing => ({
    ...item(key),
    state: "идёт",
    ...edit,
  });

  it("номера черновиков разные, растут, дробные и меньше следующего целого", () => {
    const got = withDrafts(feed(4, 5), [waiting("a"), waiting("b")], ROOM, true);
    expect(got.map((one) => [one.id, one.seq])).toEqual([
      ["записана-k4", 4],
      ["записана-k5", 5],
      ["a", 5 + 1 / 3],
      ["b", 5 + 2 / 3],
    ]);
  });

  it("новый черновик меняет номер последней строки — лента едет за ним вниз", () => {
    const one = withDrafts(feed(5), [waiting("a")], ROOM, true).at(-1)?.seq;
    const two = withDrafts(feed(5), [waiting("a"), waiting("b")], ROOM, true).at(-1)?.seq;
    expect(two).toBeGreaterThan(one ?? Number.POSITIVE_INFINITY);
  });

  it("черновик, чья запись уже в ленте, не показывается — догон бывает быстрее ответа", () => {
    const got = withDrafts(feed(4), [waiting("k4")], ROOM, true);
    expect(got.map((one) => one.id)).toEqual(["записана-k4"]);
  });

  it("лента не в конце — черновиков нет: им место у живого края", () => {
    expect(withDrafts(feed(4), [waiting("a")], ROOM, false).map((one) => one.id)).toEqual([
      "записана-k4",
    ]);
  });

  it("черновик чужого чата не показывается, состояние «не ушло» доезжает до ленты", () => {
    const got = withDrafts(
      feed(4),
      [waiting("чужой", { conversationId: OTHER }), waiting("мой", { state: "не ушло" })],
      ROOM,
      true,
    );
    expect(got.map((one) => [one.id, one.state])).toEqual([
      ["записана-k4", undefined],
      ["мой", "не ушло"],
    ]);
  });
});
