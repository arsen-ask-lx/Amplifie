/**
 * ПРИЁМОЧНЫЙ ТЕСТ ДЕЙСТВИЙ НАД РЕПЛИКОЙ (task-014).
 *
 * Проверяет ровно то, что было названо вопросами к тестам ДО кода:
 * рубежи доступа и мягкое удаление. Ни вида цитаты, ни вида полоски здесь
 * нет — это работа живого прогона, а не приёмочного теста.
 *
 * «Чужое» здесь — реплика ЧУЖОГО ПРОСТРАНСТВА: когда файл писался,
 * второго человека в том же пространстве завести было нельзя. Теперь можно
 * (`colleague` в `stand.ts`), и «сосед по пространству не правит и не
 * удаляет мою реплику» стережёт `moderation.e2e.test.ts`.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, newPerson, requireStand } from "./stand.js";

async function newOwner(tag: string): Promise<string> {
  return (await newPerson(tag)).cookie;
}

/** Время из ответа: `Date.toISOString()` сервера — миллисекунды и `Z`. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

async function firstRoom(cookie: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/conversations`, { headers: { cookie } });
  const body = (await response.json()) as { items: Array<{ id: string }> };
  const room = body.items[0];
  if (!room) throw new Error("у нового пространства нет канала");
  return room.id;
}

interface Reply {
  id: string;
  seq: number;
  body: string;
  createdAt: string;
  editedAt: string | null;
  pinnedAt: string | null;
  replyTo: { id: string; seq: number; author: string; excerpt: string } | null;
  forwardedFrom: string | null;
}

async function say(
  cookie: string,
  room: string,
  body: string,
  links: { replyToId?: string; forwardedFromId?: string } = {},
): Promise<Reply> {
  const response = await fetch(`${BASE}/v1/conversations/${room}/messages`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ body, clientMsgId: crypto.randomUUID(), ...links }),
  });
  if (response.status !== 201) throw new Error(`отправка: ${response.status}`);
  return (await response.json()) as Reply;
}

async function feed(cookie: string, room: string): Promise<Reply[]> {
  const response = await fetch(`${BASE}/v1/conversations/${room}/messages?limit=50`, {
    headers: { cookie },
  });
  const body = (await response.json()) as { items: Reply[] };
  return body.items;
}

describe("действия над репликой", () => {
  let cookie = "";
  let room = "";
  let stranger = "";
  let strangerRoom = "";

  beforeAll(async () => {
    await requireStand();
    cookie = await newOwner("Свой");
    room = await firstRoom(cookie);
    stranger = await newOwner("Чужой");
    strangerRoom = await firstRoom(stranger);
  });

  it("отвечает на видимое сообщение и отдаёт цитату в ленте", async () => {
    const target = await say(cookie, room, "исходная реплика");
    const answer = await say(cookie, room, "ответ", { replyToId: target.id });

    expect(answer.replyTo?.id).toBe(target.id);
    expect(answer.replyTo?.excerpt).toBe("исходная реплика");

    // «В ленте» — и при чтении ленты, а не только в ответе отправки.
    const inFeed = (await feed(cookie, room)).find((one) => one.id === answer.id);
    expect(inFeed?.replyTo).toEqual({
      id: target.id,
      seq: target.seq,
      author: "Свой",
      excerpt: "исходная реплика",
    });
  });

  it("не отвечает на сообщение из чужого пространства", async () => {
    // ⚠️ ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Цитата ПОКАЗЫВАЕТ ТЕКСТ: пропусти сервер
    // чужой идентификатор — и по нему вытаскивается кусок чужого разговора.
    const secret = await say(stranger, strangerRoom, "чужая тайна");

    const response = await fetch(`${BASE}/v1/conversations/${room}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        body: "попытка процитировать чужое",
        clientMsgId: crypto.randomUUID(),
        replyToId: secret.id,
      }),
    });

    expect(response.status).toBe(404);
  });

  it("правит своё и проставляет отметку «изменено»", async () => {
    const mine = await say(cookie, room, "было");

    const response = await fetch(`${BASE}/v1/messages/${mine.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ body: "стало" }),
    });
    expect(response.status).toBe(200);

    const changed = (await response.json()) as Reply;
    expect(changed.body).toBe("стало");
    // Поле заведено давно и до task-014 никем не писалось.
    expect(changed.editedAt).toMatch(ISO_TIME);
    // Отметка — время правки: не раньше, чем реплику написали. Часы разные: `createdAt`
    // ставит база (`defaultNow()`), `editedAt` — процесс (`new Date()`); секунда запаса —
    // на расхождение часов двух контейнеров, а не на поведение.
    expect(Date.parse(changed.editedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(mine.createdAt) - 1_000,
    );
  });

  it("не правит и не удаляет чужое — и отвечает 404, а не 403", async () => {
    const theirs = await say(stranger, strangerRoom, "чужая реплика");

    const edit = await fetch(`${BASE}/v1/messages/${theirs.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ body: "подмена" }),
    });
    const remove = await fetch(`${BASE}/v1/messages/${theirs.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    // 403 подтвердил бы, что сообщение существует, — по нему перебираются
    // чужие разговоры. Один код на «нет такого» и «не твоё» намеренно.
    expect(edit.status).toBe(404);
    expect(remove.status).toBe(404);

    // Положительный контроль: реплика цела и не подменена — у хозяина она есть.
    const kept = (await feed(stranger, strangerRoom)).find((one) => one.id === theirs.id);
    expect(kept?.body).toBe("чужая реплика");
  });

  it("удаляет своё: реплика уходит из ленты, а цитата на неё пустеет", async () => {
    const doomed = await say(cookie, room, "эту удалим");
    const answer = await say(cookie, room, "ответ на удаляемую", { replyToId: doomed.id });

    const before = await feed(cookie, room);
    expect(before.find((one) => one.id === answer.id)?.replyTo).toEqual({
      id: doomed.id,
      seq: doomed.seq,
      author: "Свой",
      excerpt: "эту удалим",
    });

    const removed = await fetch(`${BASE}/v1/messages/${doomed.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(removed.status).toBe(204);

    const after = await feed(cookie, room);
    // Удаление мягкое: строка в базе остаётся ради ссылок на неё, но
    // в ленте её быть не должно НИ ЗДЕСЬ, НИ В ДОГОНЕ.
    expect(after.find((one) => one.id === doomed.id)).toBeUndefined();
    expect(after.find((one) => one.id === answer.id)?.replyTo).toBeNull();
  });

  it("закрепляет и открепляет; закреплённое отдаётся отдельной дверью", async () => {
    const important = await say(cookie, room, "главное в канале");

    const pin = await fetch(`${BASE}/v1/messages/${important.id}/pin`, {
      method: "POST",
      headers: { cookie },
    });
    expect(pin.status).toBe(204);

    const pinned = await fetch(`${BASE}/v1/conversations/${room}/pinned`, { headers: { cookie } });
    const list = (await pinned.json()) as { items: Reply[] };
    expect(list.items.map((one) => one.id)).toContain(important.id);

    const off = await fetch(`${BASE}/v1/messages/${important.id}/pin`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(off.status).toBe(204);

    const empty = await fetch(`${BASE}/v1/conversations/${room}/pinned`, { headers: { cookie } });
    const rest = (await empty.json()) as { items: Reply[] };
    expect(rest.items.map((one) => one.id)).not.toContain(important.id);
  });

  it("пересылает в другой разговор и подписывает источник", async () => {
    const source = await say(cookie, room, "текст на пересылку");
    const created = await fetch(`${BASE}/v1/conversations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "Куда пересылаем" }),
    });
    const target = (await created.json()) as { id: string };

    const forwarded = await say(cookie, target.id, source.body, { forwardedFromId: source.id });
    expect(forwarded.forwardedFrom).toBe("Свой");
  });
});
