/**
 * Хозяин потока живых обновлений (task-093, срез 1).
 *
 * `EventSource` не показывал ни кода ответа, ни заголовков: 401, 429, 502
 * и обрыв сети были для него одним и тем же, а на любой не-200 он закрывался
 * навсегда. Здесь проверяется, что хозяин различает эти случаи и ведёт себя
 * в каждом по таблице состояний плана.
 */
import { describe, expect, it } from "vitest";
import { type LiveStreamDeps, openLiveStream } from "./liveStream.js";

const encoder = new TextEncoder();

/** Так отвечает настоящий поток: без типа ответ потоком не считается. */
const STREAM_HEADERS = { "content-type": "text/event-stream; charset=utf-8" };

/** Тело ответа, отдающее куски по одному и затем закрывающееся. */
function body(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Тело, которое не кончается, пока его не отменят. */
function endless(first: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(first));
    },
  });
}

interface Harness {
  deps: LiveStreamDeps;
  timers: Array<{ ms: number; run: () => void; cleared: boolean }>;
  calls: number;
  clock: { now: number };
}

function harness(responses: Array<() => Response | Promise<Response>>, random = () => 0): Harness {
  const h: Harness = {
    timers: [],
    calls: 0,
    clock: { now: 0 },
    deps: {
      fetch: async () => {
        const next = responses[h.calls] ?? responses.at(-1);
        h.calls += 1;
        if (!next) throw new Error("нет ответа");
        return next();
      },
      random,
      now: () => h.clock.now,
      setTimeout: (run, ms) => {
        const timer = { ms, run, cleared: false };
        h.timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
    },
  };
  return h;
}

/** Дать отработать цепочке обещаний чтения. */
const settle = async () => {
  for (let n = 0; n < 20; n++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function recorder() {
  const log: string[] = [];
  return {
    log,
    handlers: {
      onEvent: (event: { name: string; data: string }) => log.push(`${event.name}:${event.data}`),
      onOpen: () => log.push("open"),
      onSessionEnded: () => log.push("401"),
      onTrouble: (failures: number) => log.push(`trouble:${failures}`),
    },
  };
}

describe("хозяин потока", () => {
  it("200 — события разбираются по событиям, а не по кускам", async () => {
    const h = harness([
      () =>
        new Response(body(': поток открыт\n\nevent: changed\ndata: {"a"', ":1}\n\n"), {
          status: 200,
          headers: STREAM_HEADERS,
        }),
    ]);
    const { log, handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(log.slice(0, 2)).toEqual(["open", 'changed:{"a":1}']);
  });

  it("поток кончился — возвращается снова, а не молчит", async () => {
    const h = harness([
      () => new Response(body(": поток открыт\n\n"), { status: 200, headers: STREAM_HEADERS }),
    ]);
    const { handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.run();
    await settle();
    expect(h.calls).toBe(2);
  });

  it("429 с Retry-After — ждёт не меньше названного срока", async () => {
    const h = harness([() => new Response("", { status: 429, headers: { "retry-after": "5" } })]);
    const { log, handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(log).not.toContain("open");
    expect(h.timers[0]?.ms).toBe(5_000);
  });

  it("502 — не закрывается навсегда, а пробует снова с растущим окном", async () => {
    const h = harness([() => new Response("", { status: 502 })], () => 0.999);
    const { log, handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    h.timers[0]?.run();
    await settle();
    expect(h.calls).toBe(2);
    expect(h.timers[1]?.ms).toBeGreaterThan(h.timers[0]?.ms ?? Number.POSITIVE_INFINITY);
    expect(log).toEqual(["trouble:1", "trouble:2"]);
  });

  it("сеть упала — тоже повтор", async () => {
    const h = harness([
      () => {
        throw new TypeError("Failed to fetch");
      },
    ]);
    const { handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(h.timers).toHaveLength(1);
  });

  it("200, но не поток событий (страница прокси) — не открыт, а повтор", async () => {
    const h = harness([
      () =>
        new Response("<html>шлюз</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ]);
    const { log, handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(log).toEqual(["trouble:1"]);
    expect(h.timers).toHaveLength(1);
  });

  it("401 — сессия кончилась: сигнал и ни одной новой попытки", async () => {
    const h = harness([() => new Response("{}", { status: 401 })]);
    const { log, handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    expect(log).toEqual(["401"]);
    expect(h.timers).toHaveLength(0);
  });

  it("закрыли — чтение отменено, запланированная попытка снята", async () => {
    const h = harness([
      () => new Response("", { status: 502 }),
      () => new Response(endless(": поток открыт\n\n"), { status: 200, headers: STREAM_HEADERS }),
    ]);
    const { handlers } = recorder();
    const close = openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    close();
    expect(h.timers[0]?.cleared).toBe(true);
    h.timers[0]?.run();
    await settle();
    expect(h.calls).toBe(1);
  });

  it("соединение, умершее сразу после открытия, не сбрасывает окно", async () => {
    const h = harness(
      [() => new Response(body(": поток открыт\n\n"), { status: 200, headers: STREAM_HEADERS })],
      () => 0.999,
    );
    const { handlers } = recorder();
    openLiveStream("/v1/stream", handlers, h.deps);
    await settle();
    h.timers[0]?.run();
    await settle();
    // Сервер принимает и тут же рвёт — окно обязано расти, иначе вкладки
    // долбят его раз в секунду.
    expect(h.timers[1]?.ms).toBeGreaterThan(h.timers[0]?.ms ?? Number.POSITIVE_INFINITY);
  });
});
