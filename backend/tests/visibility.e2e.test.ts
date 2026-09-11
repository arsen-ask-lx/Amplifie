/**
 * ПРИЁМОЧНЫЙ ТЕСТ ВИДИМОСТИ ВЕТКИ (task-039, шаг 1; task-027 №1).
 * Написан ДО правки и обязан быть красным.
 *
 * Право читается у КОРНЯ: у ветки своей видимости нет (Р-010). Ветка
 * приватного канала обязана быть так же закрыта, как сам канал, — иначе
 * закрытый разговор читается через любую его ветку.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

async function newPrivateChannel(owner: Person, title: string): Promise<string> {
  const response = await call("POST", "/v1/conversations", owner, { title, visibility: "private" });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function newThread(owner: Person, channelId: string, title: string): Promise<string> {
  const response = await call("POST", `/v1/conversations/${channelId}/threads`, owner, { title });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function titlesSeenBy(person: Person): Promise<string[]> {
  const response = await call("GET", "/v1/conversations", person);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: { title: string }[] }).items.map((one) => one.title);
}

describe("ветка наследует видимость корня", () => {
  beforeAll(requireStand);

  it("ветку приватного канала посторонний не видит, не читает и не пишет в неё", async () => {
    const хозяин = await newPerson("Хозяин");
    const сосед = await colleague(хозяин, "Сосед");
    const канал = await newPrivateChannel(хозяин, "Зарплаты");
    const ветка = await newThread(хозяин, канал, "Премии за квартал");

    expect(await titlesSeenBy(сосед), "ветка закрытого канала в чужом списке").not.toContain(
      "Премии за квартал",
    );
    expect(
      (await call("GET", `/v1/conversations/${ветка}/messages`, сосед)).status,
      "ветку закрытого канала читает посторонний",
    ).toBe(404);
    expect(
      (
        await call("POST", `/v1/conversations/${ветка}/messages`, сосед, {
          body: "я тут",
          clientMsgId: crypto.randomUUID(),
        })
      ).status,
      "в ветку закрытого канала пишет посторонний",
    ).toBe(404);
  });

  it("участник закрытого канала видит его ветку и зовёт в ней только своих", async () => {
    const хозяин = await newPerson("Хозяин");
    const сосед = await colleague(хозяин, "Сосед");
    const канал = await newPrivateChannel(хозяин, "Зарплаты");
    const ветка = await newThread(хозяин, канал, "Премии за квартал");

    expect(await titlesSeenBy(хозяин)).toContain("Премии за квартал");
    expect((await call("GET", `/v1/conversations/${ветка}/messages`, хозяин)).status).toBe(200);

    // Кого звать в ветке — тот же вопрос «кто её видит», заданный с другой
    // стороны. Ответ обязан совпасть с правом читать: соседа звать нельзя.
    const people = await call("GET", `/v1/conversations/${ветка}/people`, хозяин);
    expect(people.status).toBe(200);
    const ids = ((await people.json()) as { items: { id: string }[] }).items.map((one) => one.id);
    expect(ids, "в ветке закрытого канала предлагают позвать постороннего").not.toContain(
      сосед.participantId,
    );
  });
});
