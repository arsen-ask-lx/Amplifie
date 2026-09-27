/**
 * ПРИЁМОЧНЫЙ ТЕСТ СОЗДАНИЯ И ВИДИМОСТИ КАНАЛОВ (Р-010).
 * Написан ДО кода и обязан быть красным.
 *
 * Проверки одним человеком: канал появляется у создателя, чужой не виден,
 * порядок по свежести, отказы.
 *
 * Когда файл писался, второго человека в том же пространстве завести было
 * нельзя, и четыре проверки были из него вынуты: «канал виден другому»,
 * «в открытом пишут оба», «приватный виден только своим», «ветка на тех же
 * условиях». Теперь второй человек заводится (`colleague` в `stand.ts`).
 * Приватный канал и его ветку стережёт `visibility.e2e.test.ts`; «открытый
 * канал виден коллеге» и «в открытом пишут оба» здесь пока не восстановлены —
 * это дыра, а не забывчивость (task-125, «коллега того же пространства»).
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, newPerson, requireStand } from "./stand.js";

async function newOwner(tag: string): Promise<string> {
  return (await newPerson(tag)).cookie;
}

interface Room {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
}

async function rooms(cookie: string): Promise<Room[]> {
  const response = await fetch(`${BASE}/v1/conversations`, { headers: { cookie } });
  return ((await response.json()) as { items: Room[] }).items;
}

async function createChannel(cookie: string, title: string, body: object = {}): Promise<Response> {
  return fetch(`${BASE}/v1/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title, ...body }),
  });
}

describe("каналы", () => {
  beforeAll(requireStand);

  it("созданный канал появляется в списке у создателя", async () => {
    const owner = await newOwner("Создатель");
    const response = await createChannel(owner, "Планы");
    expect(response.status).toBe(201);

    const titles = (await rooms(owner)).map((r) => r.title);
    expect(titles).toContain("Планы");
  });

  it("чужой канал не виден и не читается", async () => {
    const owner = await newOwner("Свой");
    const created = await createChannel(owner, "Не для всех");
    const { id } = (await created.json()) as { id: string };

    const read = (cookie: string) =>
      fetch(`${BASE}/v1/conversations/${id}/messages`, { headers: { cookie } });

    // Положительный контроль: у своего канал есть и читается — отказ ниже
    // про чужого, а не про несостоявшееся создание.
    expect((await rooms(owner)).map((r) => r.id)).toContain(id);
    expect((await read(owner)).status).toBe(200);

    const stranger = await newOwner("Посторонний");
    expect((await rooms(stranger)).map((r) => r.id)).not.toContain(id);
    expect((await read(stranger)).status).toBe(404);
  });

  it("список идёт по свежести: где писали последним — первый", async () => {
    // Р-011: порядок по активности решает большую часть задачи «сто
    // каналов» сам по себе — в работе нужны те же три-пять мест.
    const owner = await newOwner("Порядок");
    const first = (await (await createChannel(owner, "Ранний")).json()) as { id: string };
    const second = (await (await createChannel(owner, "Поздний")).json()) as { id: string };

    const say = async (id: string, body: string) =>
      fetch(`${BASE}/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner },
        body: JSON.stringify({ body, clientMsgId: crypto.randomUUID() }),
      });

    // Пишем в СТАРШИЙ канал первым, в младший — последним. Прежний
    // порядок «по времени создания» дал бы обратное, поэтому проверка
    // различает: с ним она красная, с новым порядком зелёная.
    // (Первая редакция была написана наоборот и проходила сама собой —
    // ложный зелёный, пойманный до того, как что-то починили.)
    await say(first.id, "в старшем");
    await say(second.id, "в младшем — и это свежее");

    const order = (await rooms(owner)).map((r) => r.id);
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
  });

  it("канал без сообщений не пропадает из списка", async () => {
    const owner = await newOwner("Молчун");
    const quiet = (await (await createChannel(owner, "Тихий")).json()) as { id: string };
    expect((await rooms(owner)).map((r) => r.id)).toContain(quiet.id);
  });

  it("без названия канал не создаётся", async () => {
    const owner = await newOwner("Безымянный");
    const response = await createChannel(owner, "   ");
    expect(response.status).toBe(422);
    // Слова — из схемы двери (`channelBody` в @amplifie/contract): их видит человек.
    expect(await response.json()).toEqual({
      error: "validation_failed",
      fields: { title: "у канала нужно название" },
    });
  });

  it("без сессии канал не создаётся", async () => {
    const response = await fetch(`${BASE}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Чужими руками" }),
    });
    expect(response.status).toBe(401);
  });
});
