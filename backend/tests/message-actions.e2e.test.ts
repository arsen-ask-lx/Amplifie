/**
 * ПРИЁМОЧНЫЙ ТЕСТ ДЕЙСТВИЙ НАД РЕПЛИКОЙ (task-014).
 *
 * Проверяет ровно то, что было названо вопросами к тестам ДО кода:
 * рубежи доступа и мягкое удаление. Ни вида цитаты, ни вида полоски здесь
 * нет — это работа живого прогона, а не приёмочного теста.
 *
 * ⚠️ ВТОРОЙ ЧЕЛОВЕК ЗАВОДИТСЯ КАК ВЛАДЕЛЕЦ ЧУЖОГО ПРОСТРАНСТВА, а не как
 * сосед по нашему: приглашений в продукте больше нет, и другой двери
 * для второго человека тоже. Поэтому «чужое» здесь — это чужое
 * пространство, а не чужая реплика в общем канале. Разница существенная,
 * и она названа: проверка «сосед не может править мою реплику» у нас
 * сейчас недоказуема, и это долг, а не забытая мелочь.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { домой } from "./дом.js";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/**
 * Адрес для нового пространства.
 *
 * ⚠️ БЕЗ МЕТКИ ЧЕЛОВЕКА В АДРЕСЕ. Метки у нас русские («Хозяин»,
 * «Чужой»), а проверка адреса на сервере кириллицу в местной части
 * не принимает и отвечает 422 — то есть весь файл падал ещё до первой
 * проверки свойства. Та же ловушка поймала и набор проверок догона.
 */
function freshEmail(): string {
  return `actions-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
  editedAt: string | null;
  pinnedAt: string | null;
  replyTo: { id: string; excerpt: string } | null;
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
    expect(changed.editedAt).not.toBeNull();
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
  });

  it("удаляет своё: реплика уходит из ленты, а цитата на неё пустеет", async () => {
    const doomed = await say(cookie, room, "эту удалим");
    const answer = await say(cookie, room, "ответ на удаляемую", { replyToId: doomed.id });

    const before = await feed(cookie, room);
    expect(before.find((one) => one.id === answer.id)?.replyTo).not.toBeNull();

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
      // Чат заводится внутри проекта — вне его жить негде (task-037).
      body: JSON.stringify({ title: "Куда пересылаем", projectId: await домой(cookie) }),
    });
    const target = (await created.json()) as { id: string };

    const forwarded = await say(cookie, target.id, source.body, { forwardedFromId: source.id });
    expect(forwarded.forwardedFrom).toBe("Свой");
  });
});
