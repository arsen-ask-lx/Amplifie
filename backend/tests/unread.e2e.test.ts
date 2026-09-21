/**
 * ПРИЁМОЧНЫЙ ТЕСТ НЕПРОЧИТАННОГО (Р-029, task-024). Написан ДО кода
 * и обязан быть красным.
 *
 * Проверяет ровно то, что в этой затее ломается молча:
 *   ① счётчик считает ЧУЖИЕ реплики и не считает свои;
 *   ② отметка двигает номер ТОЛЬКО ВПЕРЁД. Две вкладки одного человека
 *      шлют «дочитал» вразнобой, и отставшая не имеет права воскресить
 *      непрочитанное. Это главная ошибка такой работы, и глазами она
 *      не ловится;
 *   ③ ответ на отметку несёт пересчитанный сервером остаток — клиент
 *      видит только загруженный кусок ленты и посчитать сам не может.
 *
 * Бьёт по живому стеку через настоящий порт. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `unread-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
}

interface Conversation {
  id: string;
  title: string;
  parentId: string | null;
  /** Сколько чужих реплик человек ещё не видел. */
  unread: number;
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
  return { cookie: sessionCookie(response), participantId: body.participant.id };
}

/** Позвать второго в то же пространство: непрочитанное без него не проверить. */
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
  return { cookie: sessionCookie(entered), participantId: body.participant.id };
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

/** Свежее число непрочитанного у названного разговора. */
async function unreadOf(person: Person, conversationId: string): Promise<number> {
  const list = await conversations(person);
  const room = list.find((one) => one.id === conversationId);
  if (!room) throw new Error("разговор пропал из списка");
  return room.unread;
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

/** Отметить прочитанным всё до номера включительно. */
async function markRead(person: Person, conversationId: string, seq: number): Promise<Response> {
  return post(`/v1/conversations/${conversationId}/read`, { seq }, person);
}

describe("непрочитанное", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`Стек не поднят (${BASE}/health). Запусти: make up`);
  });

  describe("счётчик", () => {
    it("растёт от чужих реплик, а своя реплика гасит всё до неё", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Гость");
      const channel = await channelOf(owner);

      await say(guest, channel.id, "первое чужое");
      await say(guest, channel.id, "второе чужое");
      expect(await unreadOf(owner, channel.id), "чужие реплики не посчитались").toBe(2);

      // Ответил — значит видел, что было до ответа. Так у Slack и Telegram;
      // своих непрочитанных не бывает вовсе (владелец, 11.09).
      await say(owner, channel.id, "своё");
      expect(
        await unreadOf(owner, channel.id),
        "после своей реплики остались непрочитанные — отправка не сдвинула отметку",
      ).toBe(0);

      // У гостя своё непрочитанное: чужой здесь — хозяин.
      expect(await unreadOf(guest, channel.id)).toBe(1);
    });

    it("в новом пространстве непрочитанного нет", async () => {
      const owner = await newPerson("Одиночка");
      const channel = await channelOf(owner);
      expect(channel.unread).toBe(0);
    });

    it("обнуляется отметкой и возвращает пересчитанный остаток", async () => {
      const owner = await newPerson("Читатель");
      const guest = await invite(owner, "Писатель");
      const channel = await channelOf(owner);

      await say(guest, channel.id, "раз");
      const second = await say(guest, channel.id, "два");
      await say(guest, channel.id, "три");

      // Отмечаем ДО середины: остаток обязан быть посчитан сервером,
      // потому что клиент видит только загруженный кусок ленты.
      const partial = await markRead(owner, channel.id, second);
      expect(partial.status).toBe(200);
      expect((await partial.json()) as { unread: number }).toEqual({ unread: 1 });
      expect(await unreadOf(owner, channel.id)).toBe(1);

      const all = await markRead(owner, channel.id, second + 1);
      expect((await all.json()) as { unread: number }).toEqual({ unread: 0 });
      expect(await unreadOf(owner, channel.id)).toBe(0);
    });
  });

  describe("отметка идёт только вперёд", () => {
    it("отставшая вкладка не воскрешает прочитанное", async () => {
      /**
       * ⚠️ ГЛАВНАЯ ОШИБКА ТАКОЙ РАБОТЫ, И ГЛАЗАМИ ОНА НЕ ЛОВИТСЯ.
       * Две вкладки одного человека шлют «дочитал» вразнобой: первая
       * долистала до конца, вторая стояла на старом месте и отправила
       * свой номер ПОЗЖЕ. Простое присваивание откатило бы номер назад,
       * и непрочитанное воскресло бы само.
       *
       * Обратная проверка (task-024, П-7): заменить `GREATEST` на
       * присваивание — этот тест обязан покраснеть.
       */
      const owner = await newPerson("Двухвкладочный");
      const guest = await invite(owner, "Собеседник");
      const channel = await channelOf(owner);

      const first = await say(guest, channel.id, "раз");
      await say(guest, channel.id, "два");
      const third = await say(guest, channel.id, "три");

      // Первая вкладка дочитала до конца.
      await markRead(owner, channel.id, third);
      expect(await unreadOf(owner, channel.id)).toBe(0);

      // Вторая вкладка опоздала со своим старым номером.
      const late = await markRead(owner, channel.id, first);
      expect(late.status).toBe(200);
      expect(
        (await late.json()) as { unread: number },
        "отставшая отметка откатила прочитанное назад",
      ).toEqual({ unread: 0 });
      expect(await unreadOf(owner, channel.id), "непрочитанное воскресло").toBe(0);
    });

    it("повторная отметка тем же номером ничего не меняет", async () => {
      const owner = await newPerson("Повторяющий");
      const guest = await invite(owner, "Говорящий");
      const channel = await channelOf(owner);

      const seq = await say(guest, channel.id, "единственная");
      await markRead(owner, channel.id, seq);
      const again = await markRead(owner, channel.id, seq);

      expect((await again.json()) as { unread: number }).toEqual({ unread: 0 });
    });
  });

  describe("отметка не требует членства в разговоре", () => {
    it("вошедший позже отмечает прочитанным канал, в котором не состоит", async () => {
      /**
       * ⚠️ ЭТО НАЙДЕНО ЖИВЬЁМ, А НЕ ПРИДУМАНО. Канал открыт всему
       * пространству, и вошедший позже видит его, НЕ будучи участником:
       * строку членства заводят только тому, кто канал создал. Пока
       * отметка была `UPDATE` по строке участника, у такого человека она
       * не находила ничего, отвечала 404 и глохла — число непрочитанного
       * не гасло НИКОГДА. Владелец поймал на канале «Демо»: шесть
       * непрочитанных, которые он прочёл.
       */
      const owner = await newPerson("Заводивший");
      const channel = await channelOf(owner);
      const late = await invite(owner, "Пришедший позже");

      const seq = await say(owner, channel.id, "сказано до его прихода");
      expect(await unreadOf(late, channel.id)).toBe(1);

      const response = await markRead(late, channel.id, seq);
      expect(response.status, "отметка отказала тому, кто не состоит в канале").toBe(200);
      expect((await response.json()) as { unread: number }).toEqual({ unread: 0 });
      expect(await unreadOf(late, channel.id), "число не погасло").toBe(0);
    });
  });

  describe("task-107: лента открывается на первом непрочитанном", () => {
    it("отдаёт окно вокруг первой непрочитанной и говорит, докуда прочитано", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await invite(owner, "Сосед");
      const channel = await channelOf(owner);

      // Хозяин прочитал первые три, дальше двадцать чужих непрочитанных.
      for (let n = 1; n <= 3; n += 1) await say(guest, channel.id, `прочитанная ${n}`);
      const readTo = await say(guest, channel.id, "последняя прочитанная");
      await markRead(owner, channel.id, readTo);
      const first = await say(guest, channel.id, "первая непрочитанная");
      for (let n = 1; n <= 20; n += 1) await say(guest, channel.id, `непрочитанная ${n}`);

      const response = await get(
        `/v1/conversations/${channel.id}/messages?around=unread&limit=10`,
        owner,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        items: { seq: number; body: string }[];
        readSeq: number;
      };

      // ⚠️ ОКНО ВОКРУГ ПЕРВОЙ НЕПРОЧИТАННОЙ, А НЕ КОНЕЦ ЧАТА. Иначе человек
      // открывает чат внизу и «читает» то, чего не видел (жалоба владельца 17.09).
      expect(page.items.map((one) => one.seq)).toContain(first);
      expect(
        page.items.some((one) => one.body === "непрочитанная 20"),
        "окно доехало до конца чата — это не открытие на непрочитанном",
      ).toBe(false);
      // Черта рисуется по этому числу, и оно приходит с лентой: у чата вне
      // первой порции панели строки с отметкой может ещё не быть (Д-51).
      expect(page.readSeq, "лента не сказала, докуда прочитано").toBe(readTo);
    });

    it("непрочитанного нет — последняя страница, как раньше", async () => {
      const owner = await newPerson("Хозяин");
      const channel = await channelOf(owner);
      for (let n = 1; n <= 5; n += 1) await say(owner, channel.id, `своя ${n}`);

      const response = await get(
        `/v1/conversations/${channel.id}/messages?around=unread&limit=10`,
        owner,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as { items: { body: string }[]; hasMore: boolean };
      expect(page.items.at(-1)?.body).toBe("своя 5");
    });
  });

  describe("дверь заперта как остальные", () => {
    it("чужой в разговор не отмечает", async () => {
      const owner = await newPerson("Свой");
      const stranger = await newPerson("Чужой");
      const channel = await channelOf(owner);

      const response = await markRead(stranger, channel.id, 1);
      expect(response.status, "чужой отметил прочтение в чужом разговоре").toBe(404);
    });

    it("без сессии не отмечает", async () => {
      const owner = await newPerson("Хозяин двери");
      const channel = await channelOf(owner);

      const response = await post(`/v1/conversations/${channel.id}/read`, { seq: 1 });
      expect(response.status).toBe(401);
    });
  });
});
