/**
 * Загрузка, которая переживает короткий сбой сервера (task-096).
 *
 * Часы поддельные: ожидание сдвигает их на свою длину, поэтому срок в 30 с
 * проверяется числом, а не временем прогона.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../shared/failure.js";
import { PATIENCE_MS, patient } from "./patient.js";

function harness() {
  let clock = 0;
  const waits: number[] = [];
  return {
    waits,
    deps: {
      now: () => clock,
      random: () => 0.999,
      sleep: async (ms: number, signal?: AbortSignal) => {
        if (signal?.aborted) throw signal.reason;
        waits.push(ms);
        clock += ms;
      },
      limit: (_ms: number, signal?: AbortSignal) => signal ?? new AbortController().signal,
    },
  };
}

/** Работа, которая отвечает по очереди заданными исходами. */
function answers(outcomes: Array<number | "ok" | "сеть">) {
  let calls = 0;
  const run = async () => {
    const outcome = outcomes[calls] ?? "ok";
    calls += 1;
    if (outcome === "ok") return "ответ";
    if (outcome === "сеть") throw new TypeError("Failed to fetch");
    throw new ApiError(outcome, { error: "отказ" });
  };
  return { run, calls: () => calls };
}

describe("загрузка, которая переживает короткий сбой", () => {
  it("503 и обрыв сети — повторяет; удача отдаёт ответ", async () => {
    const h = harness();
    const work = answers([503, "сеть", "ok"]);
    await expect(patient(work.run, undefined, h.deps)).resolves.toBe("ответ");
    expect(work.calls()).toBe(3);
    expect(h.waits[1]).toBeGreaterThan(h.waits[0] ?? Number.POSITIVE_INFINITY);
  });

  it.each([401, 404, 422, 429])("%i — отказ сразу, без повтора", async (status) => {
    const h = harness();
    const work = answers([status]);
    await expect(patient(work.run, undefined, h.deps)).rejects.toMatchObject({ status });
    expect(work.calls()).toBe(1);
  });

  it("сервер лежит дольше срока — последняя ошибка через 30 с, не раньше и не позже", async () => {
    const h = harness();
    const work = answers(Array.from({ length: 50 }, () => 503));
    await expect(patient(work.run, undefined, h.deps)).rejects.toMatchObject({ status: 503 });
    const waited = h.waits.reduce((sum, one) => sum + one, 0);
    expect(waited).toBe(PATIENCE_MS);
    // 1 + 2 + 4 + 8 + 15 с (последняя пауза урезана сроком): шесть попыток.
    expect(work.calls()).toBe(6);
  });

  it("отмена снаружи прекращает повторы", async () => {
    const h = harness();
    const stop = new AbortController();
    const work = answers([503, 503, 503]);
    stop.abort();
    await expect(patient(work.run, stop.signal, h.deps)).rejects.toMatchObject({ status: 503 });
    expect(work.calls()).toBe(1);
  });
});
