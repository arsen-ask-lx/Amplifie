/**
 * НУЛЕВОЙ СИМВОЛ В ТЕКСТЕ (task-120). Найдено Schemathesis: название папки
 * с `\u0000` роняло дверь в 500 — Postgres такой символ не хранит, — а ответ
 * 500 отдавал наружу текст SQL-запроса с параметрами.
 *
 * Теперь нулевой символ — отказ проверки (422) с полем, где он встретился,
 * и ни один ответ не несёт текста запроса к базе.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, newPerson, requireStand } from "./stand.js";

const NUL = String.fromCharCode(0);

describe("нулевой символ в тексте", () => {
  beforeAll(requireStand);

  it("Н-1: название папки, канала и реплика с нулевым символом — 422, а не 500", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await call("POST", "/v1/conversations", owner, { title: "Смета" });
    expect(channel.status).toBe(201);
    const { id } = (await channel.json()) as { id: string };

    const doors: Array<["POST", string, unknown, string]> = [
      ["POST", "/v1/projects", { title: `Папка${NUL}` }, "title"],
      ["POST", "/v1/conversations", { title: `Канал${NUL}` }, "title"],
      [
        "POST",
        `/v1/conversations/${id}/messages`,
        { body: `реплика${NUL}`, clientMsgId: crypto.randomUUID() },
        "body",
      ],
      ["POST", "/v1/search/messages", { q: `смета${NUL}` }, "q"],
      ["POST", "/v1/search/chats", { q: `смета${NUL}` }, "q"],
    ];
    for (const [method, path, body, field] of doors) {
      const response = await call(method, path, owner, body);
      const text = await response.text();
      expect(response.status, `${method} ${path}`).toBe(422);
      expect(JSON.parse(text).fields[field], `${method} ${path}`).toBe(
        "в тексте недопустим нулевой символ",
      );
      expect(text.toLowerCase(), "текст запроса к базе в ответе").not.toContain("insert");
    }
  });
});
