/**
 * ПРИЁМОЧНЫЙ ТЕСТ УДАЛЕНИЯ КАНАЛА.
 *
 * Проверяются РУБЕЖИ, а не вид: кто может снести канал, что происходит
 * с чужим и что видно после. Удаление канала сносит переписку у всех
 * разом — это самое дорогое действие в продукте, и права на него
 * обязаны стеречься арбитром, а не аккуратностью.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `room-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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

async function addChannel(cookie: string, title: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title }),
  });
  if (response.status !== 201) throw new Error(`создание канала: ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

async function rooms(cookie: string): Promise<Array<{ id: string; title: string }>> {
  const response = await fetch(`${BASE}/v1/conversations`, { headers: { cookie } });
  return ((await response.json()) as { items: Array<{ id: string; title: string }> }).items;
}

const remove = (cookie: string, id: string) =>
  fetch(`${BASE}/v1/conversations/${id}`, { method: "DELETE", headers: { cookie } });

describe("удаление канала", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  it("свой канал удаляется и пропадает из списка", async () => {
    const cookie = await newOwner("Хозяин");
    const id = await addChannel(cookie, "На снос");

    expect((await rooms(cookie)).some((room) => room.id === id)).toBe(true);
    expect((await remove(cookie, id)).status).toBe(204);
    expect((await rooms(cookie)).some((room) => room.id === id)).toBe(false);
  });

  it("удалённый канал больше не читается", async () => {
    const cookie = await newOwner("Читатель");
    const id = await addChannel(cookie, "Исчезнет");
    await remove(cookie, id);

    const response = await fetch(`${BASE}/v1/conversations/${id}/messages`, {
      headers: { cookie },
    });
    expect(response.status).toBe(404);
  });

  it("чужой канал не удаляется, и отказ не выдаёт его существования", async () => {
    const mine = await newOwner("Свой");
    const stranger = await newOwner("Чужой");
    const theirs = await addChannel(stranger, "Не трогать");

    // 404, а не 403: отдельный отказ на чужое подтвердил бы, что канал есть.
    expect((await remove(mine, theirs)).status).toBe(404);
    expect((await rooms(stranger)).some((room) => room.id === theirs)).toBe(true);
  });

  it("несуществующий канал отвечает так же, как чужой", async () => {
    const cookie = await newOwner("Гадающий");
    const response = await remove(cookie, "01a00000-0000-7000-8000-000000000000");
    expect(response.status).toBe(404);
  });

  it("повторное удаление не притворяется успешным", async () => {
    const cookie = await newOwner("Настойчивый");
    const id = await addChannel(cookie, "Дважды");
    expect((await remove(cookie, id)).status).toBe(204);
    // Второй раз удалять нечего, и об этом надо сказать честно: молчаливое
    // «готово» на действие, которого не было, — тот же класс, что зелёный
    // тест без проверки.
    expect((await remove(cookie, id)).status).toBe(404);
  });
});
