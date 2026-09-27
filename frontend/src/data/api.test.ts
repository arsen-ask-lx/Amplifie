/**
 * Срок, названный сервером, доезжает до ошибки (task-111). Написан ДО кода.
 *
 * Без него очередь отправки ждала бы наугад: сервер сказал «через семь
 * секунд», а клиент этого не услышал.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { retryAfterOf, statusOf } from "../shared/failure.js";
import { api } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ statusCode: status, error: "too_many_requests" }), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
  );
}

describe("отказ сервера несёт его срок", () => {
  it("429 с retry-after: 7 — ошибка несёт 7000 мс", async () => {
    answer(429, { "retry-after": "7" });
    const error = await api.send("room", "текст", "ключ").catch((failure: unknown) => failure);
    expect([statusOf(error), retryAfterOf(error)]).toEqual([429, 7_000]);
  });

  it("срока нет — ноль, а не выдуманное число", async () => {
    answer(429);
    const error = await api.send("room", "текст", "ключ").catch((failure: unknown) => failure);
    expect([statusOf(error), retryAfterOf(error)]).toEqual([429, 0]);
  });
});
