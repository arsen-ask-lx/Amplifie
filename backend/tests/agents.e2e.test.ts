/**
 * ПРИЁМОЧНЫЙ ТЕСТ: список агентов пространства (task-007).
 * Написан ДО кода и обязан быть красным.
 *
 * Раздел «Агенты» должен отвечать на два вопроса человека: кто у меня есть
 * и почему он молчит. Второй ответ — про МОЙ мост: агент отвечает через
 * подписку того, кто позвал. Показать чужой мост как свой значит соврать
 * человеку про то, чем он платит.
 *
 * Вопросы к тестам — dock/tasks/task-007-раздел-агенты.md §6.
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";
const AGENT = "Сводка";

interface Person {
  cookie: string;
}

interface Agents {
  items: Array<{ id: string; name: string; kind: string }>;
  /** Мост СПРАШИВАЮЩЕГО: через него агент и отвечает. */
  bridge: { connected: boolean; online: boolean; name: string | null };
}

function freshEmail(): string {
  return `agents-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
  return { cookie: sessionCookie(response) };
}

function post(path: string, body: unknown, person: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify(body),
  });
}

async function agentsOf(person: Person): Promise<Agents> {
  const response = await fetch(`${BASE}/v1/agents`, { headers: { cookie: person.cookie } });
  if (!response.ok) throw new Error(`список агентов: ${response.status}`);
  return (await response.json()) as Agents;
}

async function channelOf(person: Person): Promise<{ id: string }> {
  const response = await fetch(`${BASE}/v1/conversations`, { headers: { cookie: person.cookie } });
  const list = (
    (await response.json()) as { items: Array<{ id: string; parentId: string | null }> }
  ).items;
  const channel = list.find((one) => !one.parentId);
  if (!channel) throw new Error("у нового пространства нет канала");
  return channel;
}

/** Позвать агента так, чтобы он появился: обращение + зов + ответ моста. */
async function summonAgent(person: Person): Promise<void> {
  const channel = await channelOf(person);
  const issued = await post("/v1/bridges", {}, person);
  const { code } = (await issued.json()) as { code: string };
  const joined = await fetch(`${BASE}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: "вызывающая машина" }),
  });
  const { token } = (await joined.json()) as { token: string };
  const headers = { "content-type": "application/json", authorization: `Bridge ${token}` };

  await post(
    `/v1/conversations/${channel.id}/messages`,
    { body: `@${AGENT} отзовись`, clientMsgId: crypto.randomUUID() },
    person,
  );

  const asking = post(`/v1/conversations/${channel.id}/ask`, {}, person);
  const job = (await (await fetch(`${BASE}/v1/bridge/next`, { headers })).json()) as {
    jobId: string;
  };
  await fetch(`${BASE}/v1/bridge/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jobId: job.jobId, text: "я здесь" }),
  });
  await asking;
}

async function connectBridge(person: Person, machine: string): Promise<void> {
  const issued = await post("/v1/bridges", {}, person);
  const { code } = (await issued.json()) as { code: string };
  await fetch(`${BASE}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: machine }),
  });
}

describe("список агентов", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-1 список не протекает между пространствами", () => {
    it("свой агент виден", async () => {
      const person = await newPerson("Свой");
      await summonAgent(person);

      const seen = await agentsOf(person);
      expect(seen.items).toHaveLength(1);
      expect(seen.items[0]?.name).toBe(AGENT);
      expect(seen.items[0]?.kind).toBe("agent");
    });

    it("чужой агент в списке не появляется", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужак");
      await summonAgent(owner);

      // У чужака агента ещё не звали — значит его и нет. Если бы список
      // тёк, здесь оказался бы агент соседнего пространства.
      const seen = await agentsOf(stranger);
      expect(seen.items).toHaveLength(0);
    });
  });

  describe("В-2 состояние моста — моё, а не чужое", () => {
    it("свой подключённый мост показан с его именем", async () => {
      const person = await newPerson("Смостом");
      await connectBridge(person, "ноутбук-хозяина");

      const seen = await agentsOf(person);
      expect(seen.bridge.connected).toBe(true);
      expect(seen.bridge.name).toBe("ноутбук-хозяина");
    });

    it("чужой мост своим не считается", async () => {
      const first = await newPerson("Первый");
      const second = await newPerson("Второй");
      await connectBridge(first, "машина-первого");

      // У второго моста нет. Увидеть здесь чужой — соврать про то,
      // чем человек платит.
      const seen = await agentsOf(second);
      expect(seen.bridge.connected).toBe(false);
      expect(seen.bridge.name).toBeNull();
    });
  });

  describe("В-3 чтение не создаёт агента", () => {
    it("в свежем пространстве агентов нет, пока их не позвали", async () => {
      const person = await newPerson("Свежий");

      // Читаем дважды: если GET заводит участника, второй раз список
      // окажется непустым — и в журнале появится событие без причины.
      expect((await agentsOf(person)).items).toHaveLength(0);
      expect((await agentsOf(person)).items).toHaveLength(0);

      await summonAgent(person);
      expect((await agentsOf(person)).items).toHaveLength(1);
    });
  });
});
