/**
 * Догон, который не сдаётся (task-093, срез 1).
 *
 * Раньше один отказ догона оставлял на экране «обновите страницу» — и больше
 * вкладка не пробовала. Здесь стережётся, что повтор один, окно растёт,
 * свежий сигнал не ждёт окна, а 401 не повторяется вовсе.
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

  it("свежий сигнал не ждёт окна — запланированный повтор снимается", async () => {
    const h = harness([500, "ok"]);
    h.control.kick();
    await settle();
    h.control.kick();
    await settle();
    expect(h.timers[0]?.cleared).toBe(true);
    expect(h.calls()).toBe(2);
    expect(h.timers).toHaveLength(1);
  });

  it("401 — не повторяет, а сообщает о конце сессии", async () => {
    const h = harness([401]);
    h.control.kick();
    await settle();
    expect(h.log).toEqual(["401"]);
    expect(h.timers).toHaveLength(0);
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
