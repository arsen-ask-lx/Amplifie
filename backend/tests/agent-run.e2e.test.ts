/**
 * ПРИЁМОЧНЫЙ ТЕСТ: агент берёт задачу и делает (task-011).
 * Написан ДО кода и обязан быть красным.
 *
 * ГЛАВНОЕ ЗДЕСЬ — РАЗМЫКАТЕЛЬ. Правило проекта «не решил за три попытки —
 * стоп и человеку» включается здесь впервые, и взято строже: две.
 * «Почти работает» в этом месте означает «жжёт деньги в цикле», поэтому
 * проверяется не «есть отказ», а **что третий запуск не доходит до моста
 * вовсе**.
 *
 * Вопросы к тестам — dock/tasks/task-011-агент-делает-задачу.md §6.
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

interface Person {
  cookie: string;
}

interface TaskView {
  id: string;
  title: string;
  stage: string;
  assignedTo: { id: string; kind: string } | null;
  discussionId: string | null;
  /** Сколько отказов подряд. Два — размыкатель разомкнут. */
  failedRuns: number;
}

function freshEmail(): string {
  return `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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

function call(path: string, person: Person, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { cookie: person.cookie };
  if (init.body) headers["content-type"] = "application/json";
  return fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

async function meOf(person: Person): Promise<string> {
  const body = (await (await call("/v1/me", person)).json()) as { participant: { id: string } };
  return body.participant.id;
}

async function tasksOf(person: Person): Promise<TaskView[]> {
  return ((await (await call("/v1/tasks", person)).json()) as { items: TaskView[] }).items;
}

function bridgeOf(token: string) {
  const headers = { "content-type": "application/json", authorization: `Bridge ${token}` };
  return {
    async next(): Promise<{ jobId: string; prompt: string } | null> {
      const response = await fetch(`${BASE}/v1/bridge/next`, { headers });
      if (response.status === 204) return null;
      return (await response.json()) as { jobId: string; prompt: string };
    },
    answer(jobId: string, text: string) {
      return fetch(`${BASE}/v1/bridge/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, text }),
      });
    },
    failed(jobId: string, error: string) {
      return fetch(`${BASE}/v1/bridge/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, error }),
      });
    },
  };
}

async function connectBridge(person: Person, machine: string) {
  const issued = await call("/v1/bridges", person, { method: "POST", body: "{}" });
  const { code } = (await issued.json()) as { code: string };
  const joined = await fetch(`${BASE}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: machine }),
  });
  const { token } = (await joined.json()) as { token: string };
  return bridgeOf(token);
}

/** Агент пространства: заводится при первом разборе, теми же дверьми. */
async function agentOf(person: Person): Promise<string> {
  const list = (
    (await (await call("/v1/conversations", person)).json()) as {
      items: Array<{ id: string; parentId: string | null }>;
    }
  ).items;
  const channel = list.find((one) => !one.parentId);
  if (!channel) throw new Error("у пространства нет канала");

  await call(`/v1/conversations/${channel.id}/messages`, person, {
    method: "POST",
    body: JSON.stringify({
      body: "Хорошо, я подготовлю новую редакцию договора к четвергу.",
      clientMsgId: crypto.randomUUID(),
    }),
  });
  await call(`/v1/conversations/${channel.id}/listen`, person, { method: "POST", body: "{}" });

  const seen = (await (await call("/v1/participants", person)).json()) as {
    items: Array<{ id: string; kind: string }>;
  };
  const agent = seen.items.find((one) => one.kind === "agent");
  if (!agent) throw new Error("агент не завёлся");
  return agent.id;
}

/** Завести задачу и назначить исполнителем агента. */
async function taskForAgent(person: Person, title: string): Promise<TaskView> {
  const me = await meOf(person);
  const agentId = await agentOf(person);

  const made = await call("/v1/tasks", person, {
    method: "POST",
    body: JSON.stringify({ title, responsibleId: me }),
  });
  const task = (await made.json()) as TaskView;

  await call(`/v1/tasks/${task.id}`, person, {
    method: "PATCH",
    body: JSON.stringify({ assignedToId: agentId }),
  });

  const found = (await tasksOf(person)).find((one) => one.id === task.id);
  if (!found) throw new Error("задача не нашлась");
  return found;
}

/** Запустить прогон, ответив мосту заданным образом. */
async function run(
  person: Person,
  taskId: string,
  bridge: ReturnType<typeof bridgeOf>,
  reply: (job: { jobId: string }) => Promise<Response>,
): Promise<{ status: number; prompt: string | null }> {
  const running = call(`/v1/tasks/${taskId}/run`, person, { method: "POST", body: "{}" });
  const job = await bridge.next();
  if (job) await reply(job);
  const response = await running;
  return { status: response.status, prompt: job?.prompt ?? null };
}

async function messagesOf(person: Person, conversationId: string): Promise<string[]> {
  const feed = (await (
    await call(`/v1/conversations/${conversationId}/messages?limit=50`, person)
  ).json()) as { items: Array<{ body: string; author: { kind: string } }> };
  return feed.items.map((one) => `${one.author.kind}: ${one.body}`);
}

describe("агент делает задачу", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-1 назначенная задача доходит до проверки", () => {
    it("результат появляется в обсуждении, стадия «на проверке»", async () => {
      const person = await newPerson("Поручающий");
      const bridge = await connectBridge(person, "машина-1");
      const task = await taskForAgent(person, "Свести договорённости за неделю");

      const { status } = await run(person, task.id, bridge, (job) =>
        bridge.answer(job.jobId, "Свёл: три договорённости, все к четвергу."),
      );
      expect(status).toBe(200);

      const [after] = await tasksOf(person);
      expect(after?.stage).toBe("на проверке");
      expect(after?.discussionId).toBeTruthy();

      const said = await messagesOf(person, after?.discussionId ?? "");
      expect(said.some((one) => one.startsWith("agent:") && one.includes("три"))).toBe(true);
    });

    it("в задание уходит название задачи", async () => {
      const person = await newPerson("Заданный");
      const bridge = await connectBridge(person, "машина-2");
      const task = await taskForAgent(person, "Проверить смету подрядчика");

      const { prompt } = await run(person, task.id, bridge, (job) =>
        bridge.answer(job.jobId, "Проверил."),
      );
      expect(prompt).toContain("Проверить смету подрядчика");
    });
  });

  describe("В-2 размыкатель размыкает на втором отказе", () => {
    it("после двух отказов подряд третий запуск не идёт к модели", async () => {
      const person = await newPerson("Неудачливый");
      const bridge = await connectBridge(person, "машина-3");
      const task = await taskForAgent(person, "Задача, которая не даётся");

      const first = await run(person, task.id, bridge, (job) =>
        bridge.failed(job.jobId, "модель сломалась"),
      );
      expect(first.status).toBe(502);

      const second = await run(person, task.id, bridge, (job) =>
        bridge.failed(job.jobId, "и снова"),
      );
      expect(second.status).toBe(502);

      // Третий запуск обязан отказать СРАЗУ, не доходя до моста: иначе
      // размыкателя нет, а есть счётчик, который никого не останавливает.
      const third = await call(`/v1/tasks/${task.id}/run`, person, {
        method: "POST",
        body: "{}",
      });
      expect(third.status).toBe(409);
      expect(((await third.json()) as { error: string }).error).toBe("breaker_open");
    });

    it("счётчик неудач виден человеку", async () => {
      const person = await newPerson("Считающий");
      const bridge = await connectBridge(person, "машина-4");
      const task = await taskForAgent(person, "Тоже не даётся");

      await run(person, task.id, bridge, (job) => bridge.failed(job.jobId, "раз"));
      expect((await tasksOf(person))[0]?.failedRuns).toBe(1);
    });
  });

  describe("В-3 удачный прогон сбрасывает счётчик", () => {
    it("отказ, успех, отказ — размыкателя нет", async () => {
      const person = await newPerson("Через раз");
      const bridge = await connectBridge(person, "машина-5");
      const task = await taskForAgent(person, "Через раз получается");

      await run(person, task.id, bridge, (job) => bridge.failed(job.jobId, "первый раз мимо"));
      await run(person, task.id, bridge, (job) => bridge.answer(job.jobId, "получилось"));
      expect((await tasksOf(person))[0]?.failedRuns).toBe(0);

      const again = await run(person, task.id, bridge, (job) =>
        bridge.failed(job.jobId, "снова мимо"),
      );
      // Это ПЕРВЫЙ отказ после успеха, а не третий подряд.
      expect(again.status).toBe(502);
      expect((await tasksOf(person))[0]?.failedRuns).toBe(1);
    });
  });

  describe("В-4 запускает только человек и только своё", () => {
    it("задачу с исполнителем-человеком запустить нельзя", async () => {
      const person = await newPerson("Сам себе");
      const me = await meOf(person);
      const made = await call("/v1/tasks", person, {
        method: "POST",
        body: JSON.stringify({ title: "Сделаю сам", responsibleId: me }),
      });
      const task = (await made.json()) as TaskView;
      await call(`/v1/tasks/${task.id}`, person, {
        method: "PATCH",
        body: JSON.stringify({ assignedToId: me }),
      });

      const started = await call(`/v1/tasks/${task.id}/run`, person, {
        method: "POST",
        body: "{}",
      });
      expect(started.status).toBe(422);
    });

    it("чужую задачу запустить нельзя", async () => {
      const owner = await newPerson("Владелец задачи");
      const stranger = await newPerson("Чужак");
      const task = await taskForAgent(owner, "Не твоё");

      const started = await call(`/v1/tasks/${task.id}/run`, stranger, {
        method: "POST",
        body: "{}",
      });
      expect(started.status).toBe(404);
    });
  });
});
