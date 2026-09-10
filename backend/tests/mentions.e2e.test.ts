/**
 * ПРИЁМОЧНЫЙ ТЕСТ УПОМИНАНИЙ (Р-031, task-033). Написан ДО кода
 * и обязан быть красным.
 *
 * Проверяет ровно то, что в этой затее ломается молча:
 *   ① упоминание — это ПРАВО, а не украшение. Позвать можно только того,
 *      кто видит разговор; иначе имя человека уезжает туда, где его
 *      видеть не должны, и никто об этом не узнает;
 *   ② два числа считаются ПОРОЗНЬ. Смешаются — значок упоминаний станет
 *      вторым способом сказать «есть непрочитанное», то есть ничем;
 *   ③ счётчик ГАСНЕТ. Незатухающий счётчик мы уже проходили на
 *      непрочитанном (Д-26), и нашёл его владелец глазами, а не тест;
 *   ④ набранное руками упоминанием НЕ становится. Ровно от этого ушли
 *      в Р-031, и проверить это можно только отправкой такого текста.
 *
 * Бьёт по живому стеку через настоящий порт. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `mention-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
  name: string;
}

interface Conversation {
  id: string;
  title: string;
  unread: number;
  /** Сколько раз в этом разговоре позвали именно меня и я этого не видел. */
  mentions: number;
}

/**
 * Как упоминание выглядит в теле сообщения (Р-031).
 *
 * ⚠️ СОБИРАЕТСЯ ЗДЕСЬ РУКАМИ, А НЕ ЗОВЁТСЯ ИЗ КОДА ФРОНТА. Приёмочная
 * бьёт по протоколу: если завтра фронт начнёт писать упоминание иначе,
 * а сервер по-прежнему поймёт старую запись, тест обязан покраснеть.
 * Позови он ту же функцию, что и продукт, — оба съехали бы вместе,
 * и молча.
 */
function mention(person: Person): string {
  return `[${person.name}](@${person.participantId})`;
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

async function newPerson(tag: string): Promise<Person> {
  const response = await post("/v1/auth/register", {
    email: freshEmail(),
    password: PASSWORD,
    displayName: tag,
    workspaceName: `Пространство ${tag}`,
  });
  if (response.status !== 201) throw new Error(`регистрация не удалась: ${response.status}`);
  const body = (await response.json()) as { participant: { id: string } };
  return { cookie: sessionCookie(response), participantId: body.participant.id, name: tag };
}

/** Позвать второго в то же пространство. */
async function invite(owner: Person, tag: string): Promise<Person> {
  const created = await post("/v1/invites", { maxUses: 50 }, owner);
  const { token } = (await created.json()) as { token: string };
  const entered = await post("/v1/auth/join", {
    token,
    email: freshEmail(),
    password: PASSWORD,
    displayName: tag,
  });
  if (entered.status !== 201) throw new Error(`вход по ссылке не удался: ${entered.status}`);
  const body = (await entered.json()) as { participant: { id: string } };
  return { cookie: sessionCookie(entered), participantId: body.participant.id, name: tag };
}

async function conversations(person: Person): Promise<Conversation[]> {
  const response = await get("/v1/conversations", person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: Conversation[] };
  return body.items;
}

async function channelOf(person: Person): Promise<Conversation> {
  const [channel] = await conversations(person);
  if (!channel) throw new Error("в пространстве нет ни одного канала");
  return channel;
}

async function roomOf(person: Person, conversationId: string): Promise<Conversation> {
  const room = (await conversations(person)).find((one) => one.id === conversationId);
  if (!room) throw new Error("разговор пропал из списка");
  return room;
}

async function say(person: Person, conversationId: string, body: string): Promise<number> {
  const response = await post(
    `/v1/conversations/${conversationId}/messages`,
    { body, clientMsgId: crypto.randomUUID() },
    person,
  );
  expect(response.status, `реплика «${body}» не отправилась`).toBe(201);
  const said = (await response.json()) as { seq: number };
  return said.seq;
}

/** Попытка сказать, исход которой и есть предмет проверки. */
async function trySay(person: Person, conversationId: string, body: string): Promise<Response> {
  return post(
    `/v1/conversations/${conversationId}/messages`,
    { body, clientMsgId: crypto.randomUUID() },
    person,
  );
}

async function markRead(person: Person, conversationId: string, seq: number): Promise<Response> {
  return post(`/v1/conversations/${conversationId}/read`, { seq }, person);
}

async function messageCount(person: Person, conversationId: string): Promise<number> {
  const response = await get(`/v1/conversations/${conversationId}/messages`, person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: unknown[] };
  return body.items.length;
}

describe("упоминания", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`Стек не поднят (${BASE}/health). Запусти: make up`);
  });

  describe("кого можно позвать", () => {
    it("чужого из другого пространства позвать нельзя", async () => {
      const owner = await newPerson("Хозяин");
      const чужой = await newPerson("Чужой");
      const channel = await channelOf(owner);
      const было = await messageCount(owner, channel.id);

      const response = await trySay(owner, channel.id, `привет, ${mention(чужой)}`);

      expect(
        response.status,
        "упоминание участника ЧУЖОГО пространства прошло — это утечка имени",
      ).toBe(422);
      expect(
        await messageCount(owner, channel.id),
        "сообщение с негодным упоминанием всё-таки появилось в разговоре",
      ).toBe(было);
    });

    it("того, кто не видит приватный канал, позвать нельзя", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");

      const created = await post(
        "/v1/conversations",
        { title: "Только для своих", visibility: "private" },
        owner,
      );
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      const response = await trySay(owner, id, `зову ${mention(guest)}`);
      expect(
        response.status,
        "позвали того, кто этого канала не видит: он получит значок на невидимый разговор",
      ).toBe(422);
    });

    it("своего из того же пространства позвать можно", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      const response = await trySay(owner, channel.id, `привет, ${mention(guest)}`);
      expect(response.status, "упоминание соседа по пространству отклонено").toBe(201);
    });
  });

  describe("счётчик", () => {
    it("считается отдельно от непрочитанного", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      for (let i = 0; i < 9; i++) await say(owner, channel.id, `обычная ${i}`);
      await say(owner, channel.id, `а вот тут зову ${mention(guest)}`);

      const room = await roomOf(guest, channel.id);
      expect(room.unread, "непрочитанных должно быть десять").toBe(10);
      expect(room.mentions, "упоминание должно быть одно, а не столько же, сколько сообщений").toBe(
        1,
      );
    });

    it("своё упоминание не считается", async () => {
      const owner = await newPerson("Хозяин");
      const channel = await channelOf(owner);

      await say(owner, channel.id, `напоминаю себе: ${mention(owner)}`);

      const room = await roomOf(owner, channel.id);
      expect(room.mentions, "человек позвал сам себя, и ему загорелся значок").toBe(0);
    });

    it("гаснет, когда разговор прочитан", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      const seq = await say(owner, channel.id, `зову ${mention(guest)}`);
      expect((await roomOf(guest, channel.id)).mentions).toBe(1);

      expect((await markRead(guest, channel.id, seq)).status).toBe(200);
      expect(
        (await roomOf(guest, channel.id)).mentions,
        "разговор прочитан, а значок упоминаний горит — ровно Д-26, только про упоминания",
      ).toBe(0);
    });

    it("набранное руками упоминанием не становится", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      // Ровно то написание, которое человек набрал бы сам, не выбирая
      // из списка. Поиск имени по тексту счёл бы это упоминанием — мы
      // от него ушли в Р-031, и вот проверка, что ушли.
      await say(owner, channel.id, `привет, @${guest.name}, глянь`);

      const room = await roomOf(guest, channel.id);
      expect(room.unread, "сообщение должно быть непрочитанным как обычное").toBe(1);
      expect(room.mentions, "набранное руками имя посчиталось упоминанием").toBe(0);
    });
  });

  describe("переход к упоминанию", () => {
    it("называет самое раннее неувиденное", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      const первое = await say(owner, channel.id, `раз ${mention(guest)}`);
      await say(owner, channel.id, `два ${mention(guest)}`);
      await say(owner, channel.id, `три ${mention(guest)}`);

      const response = await get(`/v1/conversations/${channel.id}/mention`, guest);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { seq: number | null };
      expect(body.seq, "переход обязан вести к САМОМУ РАННЕМУ неувиденному упоминанию").toBe(
        первое,
      );
    });

    it("в разговоре без упоминаний говорит, что идти некуда", async () => {
      const owner = await newPerson("Хозяин");
      const channel = await channelOf(owner);
      await say(owner, channel.id, "просто слова");

      const response = await get(`/v1/conversations/${channel.id}/mention`, owner);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { seq: number | null };
      expect(body.seq, "упоминаний нет, а переход куда-то ведёт").toBeNull();
    });
  });

  describe("список тех, кого можно позвать", () => {
    it("содержит соседей по пространству и агента", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      const response = await get(`/v1/conversations/${channel.id}/people`, owner);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: { id: string; name: string }[] };
      const ids = body.items.map((one) => one.id);

      expect(ids, "соседа по пространству нельзя позвать: его нет в списке").toContain(
        guest.participantId,
      );
      expect(ids, "себя в списке быть не должно: сам себя не зовут").not.toContain(
        owner.participantId,
      );
    });

    it("не содержит людей из другого пространства", async () => {
      const owner = await newPerson("Хозяин");
      const чужой = await newPerson("Чужой");
      const channel = await channelOf(owner);

      const response = await get(`/v1/conversations/${channel.id}/people`, owner);
      const body = (await response.json()) as { items: { id: string }[] };

      expect(
        body.items.map((one) => one.id),
        "в списке оказался человек из другого пространства",
      ).not.toContain(чужой.participantId);
    });
  });
});
