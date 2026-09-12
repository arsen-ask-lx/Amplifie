/**
 * ПРИЁМОЧНЫЙ ТЕСТ СОЗДАНИЯ И ВИДИМОСТИ КАНАЛОВ (Р-010).
 * Написан ДО кода и обязан быть красным.
 *
 * ⚠️ ПОЛОВИНА ЭТОГО ФАЙЛА УДАЛЕНА ВМЕСТЕ С ПРИГЛАШЕНИЯМИ. Четыре проверки
 * требовали ВТОРОГО человека в том же пространстве — «канал виден другому»,
 * «в открытом пишут оба», «приватный виден только своим», «ветка на тех же
 * условиях». Приглашение было единственной дверью для второго человека;
 * двери нет — значит и проверить нечего. Код видимости остался, но
 * доказательства у него больше НЕТ, и это сказано здесь, а не забыто.
 *
 * Осталось то, что проверяется одним человеком: канал появляется у создателя,
 * чужой не виден, порядок по свежести, отказы.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `ch-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

async function newOwner(tag: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
      workspaceName: `Пространство ${tag}`,
    }),
  });
  if (response.status !== 201) throw new Error(`регистрация: ${response.status}`);
  return sessionCookie(response);
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
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

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

    const stranger = await newOwner("Посторонний");
    expect((await rooms(stranger)).map((r) => r.id)).not.toContain(id);

    const peek = await fetch(`${BASE}/v1/conversations/${id}/messages`, {
      headers: { cookie: stranger },
    });
    expect(peek.status).toBe(404);
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
