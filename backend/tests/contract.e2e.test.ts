/**
 * ПРИЁМОЧНЫЙ ТЕСТ КОНТРАКТА ДВЕРЕЙ (Р-034; task-039, шаг 3).
 *
 * Схема двери проверяет вход и режет выход. Здесь — то, что видно снаружи:
 * мусор во входе отвечает понятным отказом по полям, а не пятисоткой,
 * и в ответ не просачивается ничего сверх объявленного.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, newPerson, requireStand } from "./stand.js";

describe("контракт дверей", () => {
  beforeAll(requireStand);

  it("мусор вместо номера в пути — 422 по полю, а не 500 с ошибкой базы (task-027 №15)", async () => {
    const person = await newPerson("Проверяющий");
    const response = await call("GET", "/v1/conversations/это-не-номер/messages", person);

    expect(response.status, "номер из пути дошёл до базы").toBe(422);
    const body = (await response.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("validation_failed");
    expect(Object.keys(body.fields)).toContain("id");
  });

  it("новый канал отдаётся ровно объявленными полями — служебные не уезжают", async () => {
    const person = await newPerson("Проверяющий");
    const response = await call("POST", "/v1/conversations", person, { title: "Смета" });
    expect(response.status).toBe(201);

    const fields = Object.keys((await response.json()) as object).sort();
    expect(fields, "в ответ просочились поля сверх контракта").toEqual([
      "id",
      "kind",
      "parentId",
      "projectId",
      "title",
    ]);
  });
});
