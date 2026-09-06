/**
 * ПРИЁМОЧНЫЙ ТЕСТ СРЕЗА «ЧАТ». Написан ДО кода и обязан быть красным.
 *
 * Проверяет три вещи, ради которых делался разбор мессенджеров
 * (dock/06-разбор-мессенджеров.md):
 *   ① сообщение нельзя потерять и нельзя задвоить;
 *   ② членство читается у корня дерева разговоров, у ветки своих участников нет;
 *   ③ порядок для клиента бездырочный и совпадает с порядком фиксации.
 *
 * Бьёт по живому стеку через настоящий порт. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

// ⚠️ Имя переменной НЕ BASE_URL: Vite (а значит и Vitest) владеет этим именем
// и подставляет туда свой `base`, то есть "/".
const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8080";

const PASSWORD = "правильный-конский-скотч-батарейка";

/** Адрес только из латиницы: кириллица в локальной части не проходит проверку. */
function freshEmail(): string {
  return `chat-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Person {
  cookie: string;
  participantId: string;
  workspaceId: string;
}

interface Conversation {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
}

/** Заводит нового человека со своим пространством и возвращает его сессию. */
async function newPerson(tag: string): Promise<Person> {
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
  if (response.status !== 201) throw new Error(`регистрация не удалась: ${response.status}`);
  const body = (await response.json()) as {
    participant: { id: string };
    workspace: { id: string };
  };
  return {
    cookie: sessionCookie(response),
    participantId: body.participant.id,
    workspaceId: body.workspace.id,
  };
}

async function get(path: string, person?: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: person ? { cookie: person.cookie } : {} });
}

async function post(path: string, body: unknown, person?: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(person ? { cookie: person.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function conversations(person: Person): Promise<Conversation[]> {
  const response = await get("/v1/conversations", person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Conversation[] };
  return body.items;
}

/** Первый канал пространства. Падает честно, если его нет. */
async function channelOf(person: Person): Promise<Conversation> {
  const [channel] = await conversations(person);
  if (!channel) throw new Error("в пространстве нет ни одного канала");
  return channel;
}

/** Отправка сообщения. client_msg_id генерирует КЛИЕНТ — это доменный ключ. */
async function send(
  person: Person,
  conversationId: string,
  body: string,
  clientMsgId = crypto.randomUUID(),
): Promise<Response> {
  return post(`/v1/conversations/${conversationId}/messages`, { body, clientMsgId }, person);
}

describe("чат", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`Стек не поднят (${BASE}/health). Запусти: make up`);
  });

  describe("канал появляется сам", () => {
    it("при регистрации в пространстве уже есть канал, и человек в нём состоит", async () => {
      const person = await newPerson("Основатель");
      const list = await conversations(person);

      expect(list).toHaveLength(1);
      expect(list[0]?.kind).toBe("channel");
      expect(list[0]?.parentId).toBeNull();
    });
  });

  describe("① сообщение нельзя потерять и нельзя задвоить", () => {
    it("отправленное сообщение читается обратно тем же текстом, байт в байт", async () => {
      const person = await newPerson("Писатель");
      const channel = await channelOf(person);
      // Разметка обязана сохраниться исходной строкой (Р-002).
      const text = "Договорились: **релиз** 20-го, а не 15-го\nвторая строка";

      const sent = await send(person, channel.id, text);
      expect(sent.status).toBe(201);

      const feed = await get(`/v1/conversations/${channel.id}/messages`, person);
      expect(feed.status).toBe(200);
      const body = (await feed.json()) as { items: Array<{ body: string }> };
      expect(body.items.at(-1)?.body).toBe(text);
    });

    it("повтор с тем же clientMsgId не создаёт второе сообщение", async () => {
      const person = await newPerson("Дубль");
      const channel = await channelOf(person);
      const clientMsgId = crypto.randomUUID();

      const first = await send(person, channel.id, "одно и то же", clientMsgId);
      const second = await send(person, channel.id, "одно и то же", clientMsgId);

      expect(first.status).toBe(201);
      // Повтор — не ошибка: клиент честно ретраит после разрыва.
      expect(second.status).toBe(200);

      const firstBody = (await first.json()) as { id: string; seq: number };
      const secondBody = (await second.json()) as { id: string; seq: number };
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.seq).toBe(firstBody.seq);

      const feed = await get(`/v1/conversations/${channel.id}/messages`, person);
      const items = ((await feed.json()) as { items: unknown[] }).items;
      expect(items).toHaveLength(1);
    });

    it("одновременная отправка не теряет ни одного сообщения и не даёт дыр в нумерации", async () => {
      const person = await newPerson("Параллель");
      const channel = await channelOf(person);

      // Ровно то, на чём ломается наивная нумерация через bigserial:
      // номер выдаётся при вставке, а видимым сообщение становится при фиксации.
      const howMany = 20;
      const responses = await Promise.all(
        Array.from({ length: howMany }, (_, i) => send(person, channel.id, `сообщение ${i}`)),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);

      const feed = await get(`/v1/conversations/${channel.id}/messages?limit=100`, person);
      const items = ((await feed.json()) as { items: Array<{ seq: number }> }).items;

      expect(items).toHaveLength(howMany);

      const numbers = items.map((m) => m.seq).sort((a, b) => a - b);
      // Без дыр: разница между соседними ровно единица.
      const gaps = numbers.filter((n, i) => i > 0 && n !== (numbers[i - 1] ?? 0) + 1);
      expect(gaps).toEqual([]);
    });

    it("догон по номеру отдаёт ровно то, что клиент пропустил", async () => {
      const person = await newPerson("Догон");
      const channel = await channelOf(person);

      await send(person, channel.id, "первое");
      const second = await send(person, channel.id, "второе");
      const cursor = ((await second.json()) as { seq: number }).seq;
      await send(person, channel.id, "третье");
      await send(person, channel.id, "четвёртое");

      const sync = await get(`/v1/sync?after=${cursor}`, person);
      expect(sync.status).toBe(200);
      const body = (await sync.json()) as { messages: Array<{ body: string }>; seq: number };

      expect(body.messages.map((m) => m.body)).toEqual(["третье", "четвёртое"]);
      expect(body.seq).toBeGreaterThan(cursor);
    });
  });

  describe("② членство читается у корня дерева", () => {
    it("чужой не видит канал и получает 404, а не 403", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужой");
      const channel = await channelOf(owner);

      const feed = await get(`/v1/conversations/${channel.id}/messages`, stranger);
      // Именно 404: код не должен выдавать, что такой разговор существует.
      expect(feed.status).toBe(404);

      const write = await send(stranger, channel.id, "я тут пишу");
      expect(write.status).toBe(404);
    });

    it("в свой список разговоров попадают только свои", async () => {
      const owner = await newPerson("Свой");
      const stranger = await newPerson("Посторонний");

      const ownerList = await conversations(owner);
      const strangerList = await conversations(stranger);

      const ownerIds = new Set(ownerList.map((c) => c.id));
      expect(strangerList.some((c) => ownerIds.has(c.id))).toBe(false);
    });

    it("у ветки нет своих участников — доступ наследуется от канала", async () => {
      const person = await newPerson("Ветка");
      const channel = await channelOf(person);

      const created = await post(
        `/v1/conversations/${channel.id}/threads`,
        { title: "О сроках" },
        person,
      );
      expect(created.status).toBe(201);
      const thread = (await created.json()) as Conversation;
      expect(thread.parentId).toBe(channel.id);
      expect(thread.kind).toBe("thread");

      // Пишем в ветку, не добавляя себя в неё отдельно: право пришло от канала.
      const wrote = await send(person, thread.id, "в ветке");
      expect(wrote.status).toBe(201);
    });

    it("чужой не попадает и в ветку чужого канала", async () => {
      const owner = await newPerson("ХозяинВетки");
      const stranger = await newPerson("ЧужойВетки");
      const channel = await channelOf(owner);

      const created = await post(
        `/v1/conversations/${channel.id}/threads`,
        { title: "Закрытая" },
        owner,
      );
      const thread = (await created.json()) as Conversation;

      const feed = await get(`/v1/conversations/${thread.id}/messages`, stranger);
      expect(feed.status).toBe(404);
    });
  });

  describe("③ разбор входа на границе", () => {
    it("пустое сообщение отклоняется с разбором по полям", async () => {
      const person = await newPerson("Пустой");
      const channel = await channelOf(person);

      const response = await send(person, channel.id, "   ");
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string; fields?: Record<string, string> };
      expect(body.error).toBe("validation_failed");
      expect(body.fields?.body).toBeTruthy();
    });

    it("без сессии писать нельзя", async () => {
      const person = await newPerson("Аноним");
      const channel = await channelOf(person);

      const response = await post(
        `/v1/conversations/${channel.id}/messages`,
        { body: "привет", clientMsgId: crypto.randomUUID() },
        undefined,
      );
      expect(response.status).toBe(401);
    });
  });
});
