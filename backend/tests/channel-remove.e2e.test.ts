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
import { BASE, newPerson, requireStand } from "./stand.js";

async function newOwner(tag: string): Promise<string> {
  return (await newPerson(tag)).cookie;
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
  beforeAll(requireStand);

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
    const read = () => fetch(`${BASE}/v1/conversations/${id}/messages`, { headers: { cookie } });

    // Положительный контроль: до удаления канал читается — 404 ниже
    // говорит об удалении, а не о неверном адресе.
    expect((await read()).status).toBe(200);
    expect((await remove(cookie, id)).status).toBe(204);

    expect((await read()).status).toBe(404);
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
    const stranger = await newOwner("Сосед");
    const theirs = await addChannel(stranger, "Чужой, но есть");

    const missing = await remove(cookie, "01a00000-0000-7000-8000-000000000000");
    const foreign = await remove(cookie, theirs);
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    // «Так же» — и тело ответа: по разнице в словах перебирают чужие адреса.
    expect(await missing.json()).toEqual(await foreign.json());
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
