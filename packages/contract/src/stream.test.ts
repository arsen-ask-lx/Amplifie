/**
 * Протокол потока живых обновлений: как читать и как возвращаться (task-093).
 *
 * Здесь стерегутся две вещи, которые клиент и прибор нагрузки обязаны
 * понимать ОДИНАКОВО. Прибор шесть раз вёл себя не как клиент (task-091),
 * потому что держал свою копию — теперь копии нет, и проверяется оригинал.
 */
import { describe, expect, it } from "vitest";
import { eventOf, framed, nextDelay, RECONNECT, retryAfterMs } from "./stream.js";

const block = (seq: number) => `event: changed\ndata: {"line":{"seq":${seq}}}`;

describe("поток режется на события, а не на куски сокета", () => {
  it("два события в одном куске — оба", () => {
    const { events, rest } = framed(`${block(1)}\n\n${block(2)}\n\n`);
    expect(events).toEqual([block(1), block(2)]);
    expect(rest).toBe("");
  });

  it("событие, разрезанное пополам, не отдаётся, пока не дочитано", () => {
    const whole = `${block(7)}\n\n`;
    const first = framed(whole.slice(0, 20));
    expect(first.events).toEqual([]);
    const second = framed(first.rest + whole.slice(20));
    expect(second.events).toEqual([block(7)]);
    expect(second.rest).toBe("");
  });

  it("сердцебиение без данных событием не считается", () => {
    expect(framed(`: тук\n\n${block(3)}\n\n`).events).toEqual([block(3)]);
  });
});

describe("событие читается по правилам SSE", () => {
  it("имя и данные", () => {
    expect(eventOf(block(4))).toEqual({ name: "changed", data: '{"line":{"seq":4}}' });
  });

  it("без имени — это message, многострочные данные склеиваются переводом строки", () => {
    expect(eventOf("data: раз\ndata: два")).toEqual({ name: "message", data: "раз\nдва" });
  });

  it("только комментарий — не событие", () => {
    expect(eventOf(": поток открыт")).toBeNull();
  });
});

describe("когда возвращаться к потоку", () => {
  it("разброс полный: от нуля до окна попытки", () => {
    expect(nextDelay(0, () => 0)).toBe(0);
    expect(nextDelay(0, () => 0.999_999)).toBeLessThan(RECONNECT.baseMs);
    expect(nextDelay(3, () => 0.5)).toBe(Math.floor(0.5 * RECONNECT.baseMs * 8));
  });

  it("окно растёт вдвое, но не выше потолка", () => {
    expect(nextDelay(2, () => 0.999_999)).toBeGreaterThan(nextDelay(1, () => 0.999_999));
    expect(nextDelay(40, () => 0.999_999)).toBeLessThan(RECONNECT.capMs);
  });

  it("сервер назвал срок — раньше него не приходим, а разброс идёт поверх", () => {
    expect(nextDelay(0, () => 0, 5_000)).toBe(5_000);
    expect(nextDelay(0, () => 0.5, 5_000)).toBe(5_000 + Math.floor(0.5 * RECONNECT.baseMs));
  });
});

describe("Retry-After", () => {
  const now = Date.parse("2026-09-16T12:00:00Z");

  it("секунды", () => {
    expect(retryAfterMs("7", now)).toBe(7_000);
  });

  it("дата в будущем и в прошлом", () => {
    expect(retryAfterMs("Wed, 16 Sep 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterMs("Wed, 16 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("нет или мусор — ноль, а не NaN", () => {
    expect(retryAfterMs(null, now)).toBe(0);
    expect(retryAfterMs("скоро", now)).toBe(0);
  });
});
