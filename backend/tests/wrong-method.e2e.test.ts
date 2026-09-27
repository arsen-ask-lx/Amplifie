/**
 * ПУТЬ ЕСТЬ, МЕТОДА НЕТ — 405 С ЗАГОЛОВКОМ `Allow` (task-120, RFC 9110 §15.5.6).
 * Найдено Schemathesis: Fastify отвечал 404, как будто пути нет вовсе.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, newPerson, requireStand } from "./stand.js";

describe("незнакомый метод на известном пути", () => {
  beforeAll(requireStand);

  it("М-1: 405 и честный список методов — у открытой двери и за сессией", async () => {
    const owner = await newPerson("Хозяин");
    const cases: Array<[string, string, string]> = [
      ["PUT", "/v1/me", "GET, HEAD"],
      ["DELETE", "/health", "GET, HEAD"],
      // QUERY без тела: Fastify отверг бы его 400 до обработчика (RFC 10008), а метода нет.
      ["QUERY", "/v1/me", "GET, HEAD"],
      ["PUT", `/v1/conversations/${crypto.randomUUID()}/messages`, "GET, HEAD, POST"],
    ];
    for (const [method, path, allow] of cases) {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { cookie: owner.cookie },
      });
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.get("allow"), `${method} ${path}`).toBe(allow);
    }
  });

  it("М-2: пути нет вовсе — по-прежнему 404", async () => {
    const response = await fetch(`${BASE}/v1/нет-такой-двери`, { method: "PUT" });
    expect(response.status).toBe(404);
  });
});
