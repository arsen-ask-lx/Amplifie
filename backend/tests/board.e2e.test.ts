/**
 * ПРИЁМОЧНЫЙ ТЕСТ: доска задач (task-010).
 * Написан ДО кода и обязан быть красным.
 *
 * ГЛАВНОЕ ЗДЕСЬ — «ЗА РЕЗУЛЬТАТ ОТВЕЧАЕТ ЧЕЛОВЕК». Это правило владельца,
 * и проверять его надо не только через ручку: проверка в коде обходится
 * следующим же кодом. Здесь проверяется ручка, а рядом — живой запрос
 * мимо приложения (§8 плана), потому что настоящий рубеж стоит в базе.
 *
 * Вопросы к тестам — dock/tasks/task-010-доска-задач.md §6.
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
  assignedTo: { id: string; name: string; kind: string } | null;
  responsible: { id: string; name: string } | null;
  fromAgreement: boolean;
}

function freshEmail(): string {
  return `board-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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

function addTask(person: Person, body: unknown): Promise<Response> {
  return call("/v1/tasks", person, { method: "POST", body: JSON.stringify(body) });
}

async function tasksOf(person: Person): Promise<TaskView[]> {
  const response = await call("/v1/tasks", person);
  if (!response.ok) throw new Error(`задачи: ${response.status}`);
  return ((await response.json()) as { items: TaskView[] }).items;
}

/** Участники пространства: нужен идентификатор агента и свой. */
async function meOf(person: Person): Promise<{ id: string; workspaceId: string }> {
  const body = (await (await call("/v1/me", person)).json()) as {
    participant: { id: string };
    workspace: { id: string };
  };
  return { id: body.participant.id, workspaceId: body.workspace.id };
}

describe("доска задач", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-3 задача заводится руками", () => {
    it("без договорённости, со стадией «к работе» по умолчанию", async () => {
      const person = await newPerson("Заводящий");
      const me = await meOf(person);

      const made = await addTask(person, {
        title: "Выгрузить логи за неделю",
        responsibleId: me.id,
      });
      expect(made.status).toBe(201);

      const [task] = await tasksOf(person);
      expect(task?.title).toBe("Выгрузить логи за неделю");
      expect(task?.stage).toBe("к работе");
      expect(task?.responsible?.id).toBe(me.id);
      expect(task?.fromAgreement).toBe(false);
    });
  });

  describe("В-1 ответственным нельзя сделать агента", () => {
    it("ручка отвергает агента в ответственных", async () => {
      const person = await newPerson("Пробующий");
      const me = await meOf(person);

      // Заводим агента: он появляется при первом обращении, но нам нужен
      // его идентификатор. Берём из списка участников.
      const agentId = await agentOf(person);

      const bad = await addTask(person, { title: "Сделает агент", responsibleId: agentId });
      expect(bad.status).toBe(422);

      // И задача не завелась даже частично.
      expect(await tasksOf(person)).toHaveLength(0);

      // А человек — можно.
      expect((await addTask(person, { title: "Сделаю сам", responsibleId: me.id })).status).toBe(
        201,
      );
    });
  });

  describe("В-2 стадии закрытым списком", () => {
    it("выдуманная стадия отвергается, известная принимается", async () => {
      const person = await newPerson("Двигающий");
      const me = await meOf(person);
      await addTask(person, { title: "Поедет", responsibleId: me.id });
      const [task] = await tasksOf(person);
      if (!task) throw new Error("задача не завелась");

      const bad = await call(`/v1/tasks/${task.id}`, person, {
        method: "PATCH",
        body: JSON.stringify({ stage: "вообще-не-стадия" }),
      });
      expect(bad.status).toBe(422);

      const good = await call(`/v1/tasks/${task.id}`, person, {
        method: "PATCH",
        body: JSON.stringify({ stage: "в работе" }),
      });
      expect(good.status).toBe(200);
      expect((await tasksOf(person))[0]?.stage).toBe("в работе");
    });
  });

  describe("В-4 исполнителем может быть агент", () => {
    it("агент назначается исполнителем, но не ответственным", async () => {
      const person = await newPerson("Назначающий");
      const me = await meOf(person);
      const agentId = await agentOf(person);

      await addTask(person, { title: "Пусть сделает агент", responsibleId: me.id });
      const [task] = await tasksOf(person);
      if (!task) throw new Error("задача не завелась");

      const assigned = await call(`/v1/tasks/${task.id}`, person, {
        method: "PATCH",
        body: JSON.stringify({ assignedToId: agentId }),
      });
      expect(assigned.status).toBe(200);

      const [after] = await tasksOf(person);
      expect(after?.assignedTo?.kind).toBe("agent");
      // Ответственный при этом остался человеком.
      expect(after?.responsible?.id).toBe(me.id);
    });
  });

  describe("В-4 чужие задачи не видны и не двигаются", () => {
    it("сосед из другого пространства не видит задачу", async () => {
      const owner = await newPerson("Хозяин доски");
      const stranger = await newPerson("Чужой");
      const me = await meOf(owner);
      await addTask(owner, { title: "Только моя", responsibleId: me.id });

      expect(await tasksOf(stranger)).toHaveLength(0);
    });

    it("чужую задачу нельзя подвинуть", async () => {
      const owner = await newPerson("Владелец");
      const stranger = await newPerson("Посторонний");
      const me = await meOf(owner);
      await addTask(owner, { title: "Не трогай", responsibleId: me.id });
      const [task] = await tasksOf(owner);
      if (!task) throw new Error("задача не завелась");

      const moved = await call(`/v1/tasks/${task.id}`, stranger, {
        method: "PATCH",
        body: JSON.stringify({ stage: "готово" }),
      });
      expect(moved.status).toBe(404);
      expect((await tasksOf(owner))[0]?.stage).toBe("к работе");
    });
  });
});

/**
 * Идентификатор участника-агента пространства.
 *
 * В свежем пространстве агента ещё НЕТ: он заводится при первом разборе.
 * Поэтому сперва даём ему повод появиться — обещание в канале и кнопка
 * «Разобрать». Идти в базу и вставлять агента руками было бы быстрее
 * и неправдой: тест обязан пользоваться теми же дверьми, что человек.
 */
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
  if (!agent) throw new Error("агент не завёлся даже после разбора");
  return agent.id;
}
