/**
 * Догон, который не сдаётся (task-093, срез 1).
 *
 * Раньше один отказ догона оставлял на экране «обновите страницу» — и больше
 * вкладка не пробовала. Здесь стережётся, что повтор один, окно растёт,
 * событие не торопит паузу, доказанная связь её снимает, а 401
 * не повторяется вовсе.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../shared/failure.js";
import { retrying } from "./retrying.js";

const settle = async () => {
  for (let n = 0; n < 10; n++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function harness(outcomes: Array<"ok" | number>) {
  const timers: Array<{ ms: number; run: () => void; cleared: boolean }> = [];
  const log: string[] = [];
  let calls = 0;
  const control = retrying(
    async () => {
      const outcome = outcomes[calls] ?? "ok";
      calls += 1;
      if (outcome !== "ok") throw new ApiError(outcome, { error: "отказ" });
    },
    {
      onFailures: (n) => log.push(`fail:${n}`),
      onRecovered: () => log.push("ok"),
      onSessionEnded: () => log.push("401"),
    },
    {
      random: () => 0.999,
      setTimeout: (run, ms) => {
        const timer = { ms, run, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
    },
  );
  return { control, timers, log, calls: () => calls };
}

describe("догон, который не сдаётся", () => {
  it("упал дважды — повторяет сам, окно растёт, удача сбрасывает счёт", async () => {
    const h = harness([500, 500, "ok"]);
    h.control.kick();
    await settle();
    h.timers[0]?.run();
    await settle();
    h.timers[1]?.run();
    await settle();
    expect(h.calls()).toBe(3);
    expect(h.timers[1]?.ms).toBeGreaterThan(h.timers[0]?.ms ?? Number.POSITIVE_INFINITY);
    expect(h.log).toEqual(["fail:1", "fail:2", "ok"]);
  });

  /**
   * ⚠️ ЗАМЕНА АРБИТРА, НАЗВАННАЯ ВСЛУХ (task-097). Здесь стояло «свежий
   * сигнал не ждёт окна — запланированный повтор снимается»: проверка
   * требовала поведения, которое запрещает спецификация `talk/live-updates`
   * («отказ догона повторяется по правилу задержки»). Пока в чате писали,
   * каждая реплика после отказа шла в догон сразу. Сигнал теперь делится
   * на два: событие паузу не снимает, доказанная связь — снимает.
   */
  it("событие во время паузы не зовёт работу и паузу не снимает", async () => {
    const h = harness([500]);
    h.control.kick();
    await settle();
    for (const signal of [h.control.kick, h.control.kick]) signal();
    await settle();
    expect([h.calls(), h.timers[0]?.cleared]).toEqual([1, false]);
  });

  it("доказанная связь снимает паузу и идёт сразу, счёт неудач не обнуляя", async () => {
    const h = harness([500, 500]);
    h.control.kick();
    await settle();
    h.control.now();
    await settle();
    // «fail:2», а не «fail:1»: счёт продолжился, значит и пауза дальше длиннее.
    expect([h.timers[0]?.cleared, h.calls(), h.log]).toEqual([true, 2, ["fail:1", "fail:2"]]);
  });

  it("401 — не повторяет, а сообщает о конце сессии", async () => {
    const h = harness([401]);
    h.control.kick();
    await settle();
    expect(h.log).toEqual(["401"]);
    expect(h.timers).toHaveLength(0);
  });

  it("два сигнала во время одного прохода — один отказ, один таймер", async () => {
    let fail: (error: unknown) => void = () => undefined;
    let calls = 0;
    const timers: Array<{ cleared: boolean }> = [];
    const log: string[] = [];
    // Как настоящий догон: пока проход идёт, повторный вызов отдаёт ТОТ ЖЕ промис.
    let running: Promise<void> | null = null;
    const control = retrying(
      () => {
        running ??= new Promise<void>((_, reject) => {
          calls += 1;
          fail = reject;
        });
        return running;
      },
      {
        onFailures: (n) => log.push(`fail:${n}`),
        onRecovered: () => log.push("ok"),
        onSessionEnded: () => log.push("401"),
      },
      {
        random: () => 0,
        setTimeout: () => {
          const timer = { cleared: false };
          timers.push(timer);
          return timer;
        },
        clearTimeout: (timer) => {
          (timer as { cleared: boolean }).cleared = true;
        },
      },
    );
    control.kick();
    control.kick();
    fail(new ApiError(500, { error: "отказ" }));
    await settle();
    expect(calls).toBe(1);
    expect(log).toEqual(["fail:1"]);
    expect(timers.filter((one) => !one.cleared)).toHaveLength(1);
  });

  it("остановлен во время прохода — удача никому не сообщается", async () => {
    let succeed: () => void = () => undefined;
    const log: string[] = [];
    const control = retrying(
      () =>
        new Promise<void>((resolve) => {
          succeed = resolve;
        }),
      {
        onFailures: (n) => log.push(`fail:${n}`),
        onRecovered: () => log.push("ok"),
        onSessionEnded: () => log.push("401"),
      },
    );
    control.kick();
    control.stop();
    succeed();
    await settle();
    expect(log).toEqual([]);
  });

  it("остановлен — повтор снят и больше не случается", async () => {
    const h = harness([500]);
    h.control.kick();
    await settle();
    h.control.stop();
    expect(h.timers[0]?.cleared).toBe(true);
    h.control.kick();
    await settle();
    expect(h.calls()).toBe(1);
  });
});
