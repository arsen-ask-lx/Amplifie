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
    const человек = await newPerson("Проверяющий");
    const ответ = await call("GET", "/v1/conversations/это-не-номер/messages", человек);

    expect(ответ.status, "номер из пути дошёл до базы").toBe(422);
    const тело = (await ответ.json()) as { error: string; fields: Record<string, string> };
    expect(тело.error).toBe("validation_failed");
    expect(Object.keys(тело.fields)).toContain("id");
  });

  it("пустое сообщение отклоняется по полю body", async () => {
    const человек = await newPerson("Проверяющий");
    const список = await call("GET", "/v1/conversations", человек);
    const канал = ((await список.json()) as { items: { id: string }[] }).items[0]?.id;

    const ответ = await call("POST", `/v1/conversations/${канал}/messages`, человек, {
      body: "   ",
      clientMsgId: crypto.randomUUID(),
    });
    expect(ответ.status).toBe(422);
    const тело = (await ответ.json()) as { fields: Record<string, string> };
    expect(тело.fields.body).toBe("сообщение пустое");
  });

  it("новый канал отдаётся ровно объявленными полями — служебные не уезжают", async () => {
    const человек = await newPerson("Проверяющий");
    const ответ = await call("POST", "/v1/conversations", человек, { title: "Смета" });
    expect(ответ.status).toBe(201);

    const поля = Object.keys((await ответ.json()) as object).sort();
    expect(поля, "в ответ просочились поля сверх контракта").toEqual([
      "id",
      "kind",
      "parentId",
      "projectId",
      "title",
    ]);
  });
});
