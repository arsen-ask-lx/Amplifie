/**
 * ПРИЁМОЧНЫЙ ТЕСТ ГРАНИЦ ДОГОНА (task-039, шаг 4; task-027 №3, №4, №5).
 * Написан ДО правки и обязан быть красным.
 *
 * Догон — единственный путь, которым изменения доезжают до открытой
 * вкладки (Р-006). Потерянная на границе страницы строка не вернётся
 * до перезагрузки, а курсор, ушедший назад, гоняет одно и то же по кругу.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

interface Line {
  id: string;
  deleted?: true;
}

interface Page {
  messages: Line[];
  seq: number;
  hasMore: boolean;
}

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

async function say(person: Person, channel: string, body: string, replyToId?: string) {
  const response = await call("POST", `/v1/conversations/${channel}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
    ...(replyToId ? { replyToId } : {}),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; seq: number };
}

async function page(person: Person, after: number, limit: number): Promise<Page> {
  const response = await call("GET", `/v1/sync?after=${after}&limit=${limit}`, person);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

/** Текущая голова: догон с «после нуля» и пустой страницей не нужен — берём из ленты. */
async function head(person: Person, channel: string): Promise<number> {
  const response = await call("GET", `/v1/conversations/${channel}/messages?limit=1`, person);
  return ((await response.json()) as { head: number }).head;
}

/** Догнать до конца страницами, как клиент. Предел — чтобы ушедший назад курсор не вешал тест. */
async function drain(person: Person, from: number, limit: number) {
  const seen: Line[] = [];
  let cursor = from;
  for (let step = 0; step < 20; step++) {
    const next = await page(person, cursor, limit);
    seen.push(...next.messages);
    if (next.seq < cursor) throw new Error(`курсор ушёл назад: ${cursor} → ${next.seq}`);
    cursor = next.seq;
    if (!next.hasMore) return { seen, cursor };
  }
  throw new Error("догон не кончился за 20 страниц");
}

describe("границы догона", () => {
  beforeAll(requireStand);

  it("правка старой реплики на границе страницы не уводит курсор назад (№3)", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const old = await say(owner, channel, "первая");
    await say(owner, channel, "вторая");
    await say(owner, channel, "третья");
    const before = await head(owner, channel);

    const edit = await call("PATCH", `/v1/messages/${old.id}`, owner, {
      body: "первая, исправлено",
    });
    expect(edit.status).toBe(200);

    const { seen, cursor } = await drain(owner, before, 1);
    expect(seen.map((one) => one.id)).toContain(old.id);
    expect(cursor, "курсор не дошёл до правки").toBeGreaterThan(before);
  });

  it("удаление реплики с ответами доезжает целиком, даже когда рвёт страницу (№4)", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const original = await say(owner, channel, "исходная");
    const responses = [
      await say(owner, channel, "ответ 1", original.id),
      await say(owner, channel, "ответ 2", original.id),
      await say(owner, channel, "ответ 3", original.id),
    ];
    const before = await head(owner, channel);

    expect((await call("DELETE", `/v1/messages/${original.id}`, owner)).status).toBe(204);

    const { seen } = await drain(owner, before, 2);
    const ids = new Set(seen.map((one) => one.id));
    expect(ids.has(original.id), "надгробие удалённой не доехало").toBe(true);
    for (const response of responses) {
      expect(ids.has(response.id), "ответ на удалённую потерялся на границе страницы").toBe(true);
    }
  });

  it("отметка «прочитано» из будущего не глушит следующие сообщения (№5)", async () => {
    const owner = await newPerson("Хозяин");
    const neighbour = await colleague(owner, "Сосед");
    const channel = await firstChannel(owner);

    const mark = await call("POST", `/v1/conversations/${channel}/read`, owner, { seq: 2 ** 40 });
    expect(mark.status).toBe(200);

    await say(neighbour, channel, "новое после отметки");

    const panel = await call("GET", "/v1/conversations", owner);
    const row = ((await panel.json()) as { items: { id: string; unread: number }[] }).items.find(
      (one) => one.id === channel,
    );
    expect(row?.unread, "новое сообщение сочтено прочитанным заранее").toBe(1);
  });
});
