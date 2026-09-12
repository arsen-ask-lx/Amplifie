/**
 * ПРИЁМОЧНЫЙ ТЕСТ: агент отвечает в чате по обращению (task-006).
 * Написан ДО кода и обязан быть красным.
 *
 * ПОЧЕМУ МОДЕЛЬ ЗДЕСЬ НЕ ПОДДЕЛЫВАЕТСЯ ВНУТРИ ПРОЦЕССА. Тест сам становится
 * мостом: подключается через `/v1/bridge/join` и разбирает работу через
 * `/v1/bridge/next`. Это не мок — это настоящая вторая сторона протокола,
 * та же, что запускается на машине человека. Поэтому тест видит РОВНО ТУ
 * подсказку, которую получит живая модель, и может утверждать про её
 * содержимое, а не только про факт ответа.
 *
 * Главная проверка здесь — не «ответ пришёл», а «в подсказку ушёл ИМЕННО
 * ЭТОТ разговор». Агент, отвечающий общими словами, выглядит работающим
 * и бесполезен.
 *
 * Вопросы к тестам — dock/tasks/task-006-агент-отвечает-в-чате.md §6.
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/** Имя участника-агента. Заводится сервером, см. ensureAgent. */
const AGENT = "memo";

interface Person {
  cookie: string;
  name: string;
}

interface Conversation {
  id: string;
  title: string;
  parentId: string | null;
}

interface Message {
  id: string;
  body: string;
  kind: string;
  seq: number;
  author: { id: string; name: string; kind: string };
}

function freshEmail(): string {
  return `ask-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

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
  if (response.status !== 201) throw new Error(`регистрация ${tag}: ${response.status}`);
  return { cookie: sessionCookie(response), name: tag };
}

function get(path: string, person: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { cookie: person.cookie } });
}

function post(path: string, body: unknown, person: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify(body),
  });
}

async function channelOf(person: Person): Promise<Conversation> {
  const response = await get("/v1/conversations", person);
  const list = ((await response.json()) as { items: Conversation[] }).items;
  const channel = list.find((one) => !one.parentId);
  if (!channel) throw new Error("у нового пространства нет канала");
  return channel;
}

async function send(person: Person, conversationId: string, body: string): Promise<void> {
  const clientMsgId = crypto.randomUUID();
  const response = await post(
    `/v1/conversations/${conversationId}/messages`,
    { body, clientMsgId },
    person,
  );
  if (response.status !== 201) throw new Error(`отправка: ${response.status}`);
}

async function feedOf(person: Person, conversationId: string): Promise<Message[]> {
  const response = await get(`/v1/conversations/${conversationId}/messages?limit=100`, person);
  if (!response.ok) throw new Error(`лента: ${response.status}`);
  return ((await response.json()) as { items: Message[] }).items;
}

/** Позвать агента разобрать разговор. Именно эту ручку зовёт клиент. */
function askAgent(person: Person, conversationId: string): Promise<Response> {
  return post(`/v1/conversations/${conversationId}/ask`, {}, person);
}

/** Поддельный мост — вторая сторона протокола, а не заглушка модели. */
function fakeBridge(token: string) {
  const headers = { "content-type": "application/json", authorization: `Bridge ${token}` };
  return {
    async next(): Promise<{ jobId: string; system: string; prompt: string } | null> {
      const response = await fetch(`${BASE}/v1/bridge/next`, { headers });
      if (response.status === 204) return null;
      return (await response.json()) as { jobId: string; system: string; prompt: string };
    },
    answer(jobId: string, text: string): Promise<Response> {
      return fetch(`${BASE}/v1/bridge/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, text }),
      });
    },
    failed(jobId: string, error: string): Promise<Response> {
      return fetch(`${BASE}/v1/bridge/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, error }),
      });
    },
  };
}

async function connectBridge(person: Person, machine: string) {
  const issued = await post("/v1/bridges", {}, person);
  if (issued.status !== 201) throw new Error(`выдача кода: ${issued.status}`);
  const { code } = (await issued.json()) as { code: string };

  const joined = await fetch(`${BASE}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: machine }),
  });
  if (joined.status !== 200) throw new Error(`подключение моста: ${joined.status}`);
  const { token } = (await joined.json()) as { token: string };
  return fakeBridge(token);
}

/**
 * Мост обязан ЖДАТЬ работу, а не опрашивать: `/v1/bridge/next` держит
 * соединение. Поэтому зов и приход за работой идут одновременно.
 */
async function askWhileBridgeAnswers(
  person: Person,
  conversationId: string,
  bridge: ReturnType<typeof fakeBridge>,
  reply: (job: { system: string; prompt: string }) => Promise<Response> | Response,
): Promise<{ response: Response; job: { system: string; prompt: string } | null }> {
  const asking = askAgent(person, conversationId);

  const job = await bridge.next();
  if (job) await reply(job);

  return { response: await asking, job };
}

describe("агент отвечает в чате", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-1 обращение рождает ответ, его отсутствие — нет", () => {
    it("обращение к агенту рождает в ленте сообщение от него", async () => {
      const person = await newPerson("Обращающийся");
      const channel = await channelOf(person);
      const bridge = await connectBridge(person, "машина-1");

      await send(person, channel.id, `@${AGENT} о чём мы договорились?`);

      const { response } = await askWhileBridgeAnswers(person, channel.id, bridge, (job) =>
        bridge.answer((job as { jobId: string } & typeof job).jobId, "Договорились о смете."),
      );

      expect(response.status).toBe(201);

      const feed = await feedOf(person, channel.id);
      const fromAgent = feed.filter((one) => one.author.kind === "agent");
      expect(fromAgent).toHaveLength(1);
      expect(fromAgent[0]?.body).toContain("смете");
      expect(fromAgent[0]?.author.name).toBe(AGENT);
    });

    // Утверждение «мост не разбудили» стоит полного срока ожидания: /v1/bridge/next
    // держит соединение, и пустой ответ приходит только по истечении срока.
    // Это не медленный тест, а цена доказательства, что денег не потратили.
    it("сообщение без обращения не рождает ответа и не будит мост", {
      timeout: 45_000,
    }, async () => {
      const person = await newPerson("Молчаливый");
      const channel = await channelOf(person);
      const bridge = await connectBridge(person, "машина-2");

      await send(person, channel.id, "просто болтаю, никого не зову");

      const response = await askAgent(person, channel.id);
      expect(response.status).toBe(204);

      // Работы мосту не пришло: модель не звали, значит и денег не потратили.
      expect(await bridge.next()).toBeNull();

      const feed = await feedOf(person, channel.id);
      expect(feed.filter((one) => one.author.kind === "agent")).toHaveLength(0);
    });
  });

  describe("В-2 в подсказку уходит именно этот разговор", () => {
    it("подсказка несёт реплики разговора, а не общий текст", async () => {
      const person = await newPerson("Контекстный");
      const channel = await channelOf(person);
      const bridge = await connectBridge(person, "машина-3");

      await send(person, channel.id, "смету по кровле готовим к пятнице");
      await send(person, channel.id, "подрядчик просит предоплату сорок процентов");
      await send(person, channel.id, `@${AGENT} подведи итог`);

      const { job } = await askWhileBridgeAnswers(person, channel.id, bridge, (one) =>
        bridge.answer((one as { jobId: string } & typeof one).jobId, "Итог подведён."),
      );

      expect(job).not.toBeNull();
      expect(job?.prompt).toContain("смету по кровле");
      expect(job?.prompt).toContain("предоплату сорок процентов");
      // Автор у каждой строки: иначе модель не отличит, кто что сказал.
      expect(job?.prompt).toContain("Контекстный");
    });

    it("в подсказку не попадают реплики чужого разговора", async () => {
      const person = await newPerson("Двухканальный");
      const first = await channelOf(person);
      const bridge = await connectBridge(person, "машина-4");

      const made = await post("/v1/conversations", { title: "второй канал" }, person);
      expect(made.status).toBe(201);
      const second = (await made.json()) as Conversation;

      await send(person, second.id, "тайна второго канала: пароль от сейфа");
      await send(person, first.id, `@${AGENT} что тут было?`);

      const { job } = await askWhileBridgeAnswers(person, first.id, bridge, (one) =>
        bridge.answer((one as { jobId: string } & typeof one).jobId, "Ничего особенного."),
      );

      expect(job?.prompt).not.toContain("тайна второго канала");
    });
  });

  describe("В-3 отказ модели не оставляет следа в разговоре", () => {
    it("мост ответил отказом — в ленте не появилось сообщения", async () => {
      const person = await newPerson("Неудачливый");
      const channel = await channelOf(person);
      const bridge = await connectBridge(person, "машина-5");

      await send(person, channel.id, `@${AGENT} посчитай`);
      const before = (await feedOf(person, channel.id)).length;

      const { response } = await askWhileBridgeAnswers(person, channel.id, bridge, (job) =>
        bridge.failed((job as { jobId: string } & typeof job).jobId, "модель недоступна"),
      );

      expect(response.status).toBe(502);

      const after = await feedOf(person, channel.id);
      expect(after).toHaveLength(before);
      expect(after.filter((one) => one.author.kind === "agent")).toHaveLength(0);
    });

    it("моста нет вовсе — отказ 503 и молчание в ленте", async () => {
      const person = await newPerson("Безмостовый");
      const channel = await channelOf(person);

      await send(person, channel.id, `@${AGENT} ответь`);
      const before = (await feedOf(person, channel.id)).length;

      const response = await askAgent(person, channel.id);
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toBe("model_unavailable");

      expect(await feedOf(person, channel.id)).toHaveLength(before);
    });
  });

  describe("В-4 ответ агента помечен как агентский", () => {
    it("своё же сообщение агента не считается новым обращением", { timeout: 45_000 }, async () => {
      const person = await newPerson("Зацикленный");
      const channel = await channelOf(person);
      const bridge = await connectBridge(person, "машина-6");

      await send(person, channel.id, `@${AGENT} привет`);
      await askWhileBridgeAnswers(person, channel.id, bridge, (job) =>
        // Агент отвечает текстом, который сам выглядит обращением.
        bridge.answer((job as { jobId: string } & typeof job).jobId, `@${AGENT} и тебе привет`),
      );

      const answer = (await feedOf(person, channel.id)).find((one) => one.author.kind === "agent");
      expect(answer?.kind).toBe("agent");

      // Второй зов не должен ничего родить: последнее слово — за агентом,
      // а его обращения не считаются. Иначе получится вечная петля.
      const again = await askAgent(person, channel.id);
      expect(again.status).toBe(204);
      expect(await bridge.next()).toBeNull();
    });
  });

  describe("В-5 чужой разговор недоступен", () => {
    it("участник другого пространства не может позвать агента", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужак");
      const channel = await channelOf(owner);

      await send(owner, channel.id, `@${AGENT} привет`);

      const response = await askAgent(stranger, channel.id);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("not_found");
    });
  });
});
