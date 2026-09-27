import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { framed, nextDelay, retryAfterMs } from "./stream.js";

/** Свойства протокола потока (task-121). */
const RUNS = { numRuns: 300 };

/** Самый долгий срок, который браузерный таймер держит честно: 2³¹−1 мс. */
const TIMER_MAX = 2_147_483_647;

/**
 * Окно разброса по номеру попытки — посчитано руками по обещанию, а не
 * формулой из `stream.ts`: секунда на первую, вдвое на каждую следующую,
 * не больше тридцати. Попытка 5 и дальше (и отрицательные — как нулевая) —
 * потолок.
 */
const WINDOW_BY_ATTEMPT = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

/** Событие потока: строки `event:`/`data:` без пустой строки внутри. */
const event = fc
  .tuple(fc.constantFrom("changed", "ping", "message"), fc.string({ maxLength: 12 }))
  .map(([name, data]) => `event: ${name}\ndata: ${data.replaceAll("\n", " ")}`);

describe("поток: свойства", () => {
  it("поток, порезанный где угодно, даёт те же события, что цельный", () => {
    fc.assert(
      fc.property(
        fc.array(event, { maxLength: 6 }),
        fc.array(fc.nat(), { maxLength: 8 }),
        (events, cuts) => {
          const whole = events.map((one) => `${one}\n\n`).join("");
          const at = [...new Set(cuts.map((cut) => cut % (whole.length + 1)))].sort(
            (a, b) => a - b,
          );
          const got: string[] = [];
          let rest = "";
          let from = 0;
          for (const to of [...at, whole.length]) {
            const next = framed(rest + whole.slice(from, to));
            got.push(...next.events);
            rest = next.rest;
            from = to;
          }
          expect(got).toEqual(framed(whole).events);
          expect(rest).toBe("");
        },
      ),
      RUNS,
    );
  });

  it("задержка переподключения — в окне поверх срока сервера", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 40 }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        fc.integer({ min: -5_000, max: 120_000 }),
        (attempt, random, floor) => {
          const window = WINDOW_BY_ATTEMPT[Math.min(Math.max(0, attempt), 5)] ?? Number.NaN;
          // Точное значение, а не «меньше верха окна»: суженное окно (секунда → полсекунды,
          // потолок 30 → 15 с) проходило бы верхнюю границу молча (ревью task-125).
          expect(nextDelay(attempt, () => random, floor)).toBe(
            Math.max(0, floor) + Math.floor(random * window),
          );
        },
      ),
      RUNS,
    );
  });

  it("срок у границы таймера плюс разброс не переваливает за неё", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (attempt, random) => {
          expect(nextDelay(attempt, () => random, TIMER_MAX)).toBeLessThanOrEqual(TIMER_MAX);
        },
      ),
      RUNS,
    );
  });

  it("срок сервера — не меньше нуля и не больше, чем держит таймер", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.nat().map(String),
          fc.bigInt({ min: 0n, max: 10n ** 12n }).map(String),
        ),
        (header) => {
          const wait = retryAfterMs(header, Date.UTC(2026, 8, 27));
          expect(Number.isFinite(wait)).toBe(true);
          expect(wait).toBeGreaterThanOrEqual(0);
          expect(wait).toBeLessThanOrEqual(TIMER_MAX);
        },
      ),
      RUNS,
    );
  });
});
