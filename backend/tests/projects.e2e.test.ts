/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПРОЕКТОВ (Р-032, task-034). Написан ДО кода
 * и обязан быть красным.
 *
 * ⚠️ ПЕРВОЙ СТОИТ ПРОВЕРКА УТЕЧКИ, И ЭТО НЕ ПОРЯДОК РАДИ ПОРЯДКА.
 * Агент, ходящий по чатам проекта, — это способ прочитать закрытое:
 * спрашиваешь в открытом канале, а он отвечает из закрытого. Утечка
 * не видна ни в одном списке прав: человек просто получает текст.
 * У ошибки есть имя — OWASP `LLM06: Excessive Agency`.
 *
 * ⚠️ СМОТРИМ В ПРИГЛАШЕНИЕ МОДЕЛИ, А НЕ В ОТВЕТ. Тест сам становится
 * мостом (как в `ask.e2e`) и видит РОВНО ТУ подсказку, которую получит
 * живая модель. Проверять ответ было бы проверкой модели, а не нашей
 * границы: модель может не упомянуть закрытое просто потому, что
 * не сочла нужным, — и тест позеленел бы на дырявом коде.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";
const AGENT = "memo";

/**
 * Слово-маркер из закрытого чата.
 *
 * Редкое нарочно: если оно окажется в приглашении, это не совпадение
 * и не общая фраза, а именно та реплика.
 */
const ТАЙНА = "криптоквазиморфный";

function freshEmail(): string {
  return `project-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
  /** К какому проекту относится. `null` — вне проектов. */
  projectId: string | null;
}

interface Project {
  id: string;
  title: string;
}

async function get(path: string, person?: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: person ? { cookie: person.cookie } : {} });
}

async function post(path: string, body: unknown, person?: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(person ? { cookie: person.cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, person: Person): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: person.cookie },
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

async function projects(person: Person): Promise<Project[]> {
  const response = await get("/v1/conversations", person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { projects: Project[] };
  return body.projects ?? [];
}

async function newProject(person: Person, title: string): Promise<Project> {
  const response = await post("/v1/projects", { title }, person);
  expect(response.status, `проект «${title}» не завёлся`).toBe(201);
  return (await response.json()) as Project;
}

async function newChannel(
  person: Person,
  title: string,
  visibility?: "workspace" | "private",
): Promise<Conversation> {
  const response = await post(
    "/v1/conversations",
    visibility ? { title, visibility } : { title },
    person,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Conversation;
}

/** Завести канал СРАЗУ внутри проекта — одним запросом (task-035). */
async function newChannelIn(person: Person, title: string, projectId: string): Promise<Response> {
  return post("/v1/conversations", { title, projectId }, person);
}

async function renameProject(person: Person, id: string, title: string): Promise<Response> {
  return patch(`/v1/projects/${id}`, { title }, person);
}

async function removeProject(person: Person, id: string): Promise<Response> {
  return fetch(`${BASE}/v1/projects/${id}`, {
    method: "DELETE",
    headers: { cookie: person.cookie },
  });
}

/** Отнести чат к проекту либо снять (`null`). */
async function toProject(
  person: Person,
  conversationId: string,
  projectId: string | null,
): Promise<Response> {
  return patch(`/v1/conversations/${conversationId}`, { projectId }, person);
}

async function say(person: Person, conversationId: string, body: string): Promise<void> {
  const response = await post(
    `/v1/conversations/${conversationId}/messages`,
    { body, clientMsgId: crypto.randomUUID() },
    person,
  );
  expect(response.status, `реплика «${body}» не отправилась`).toBe(201);
}

/** Поддельный мост — настоящая вторая сторона протокола, а не заглушка. */
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
  };
}

async function connectBridge(person: Person): Promise<ReturnType<typeof fakeBridge>> {
  const issued = await post("/v1/bridges", {}, person);
  if (issued.status !== 201) throw new Error(`выдача кода: ${issued.status}`);
  const { code } = (await issued.json()) as { code: string };

  const joined = await post("/v1/bridge/join", { code, name: "машина-проверки" });
  if (joined.status !== 200) throw new Error(`подключение моста: ${joined.status}`);
  const { token } = (await joined.json()) as { token: string };
  return fakeBridge(token);
}

/**
 * Позвать агента и поймать приглашение, которое ушло бы модели.
 *
 * `scope` — область чтения: этот чат либо весь проект.
 */
async function askAndCatchPrompt(
  person: Person,
  conversationId: string,
  bridge: ReturnType<typeof fakeBridge>,
  scope?: "conversation" | "project",
): Promise<{ prompt: string; status: number }> {
  const asking = post(`/v1/conversations/${conversationId}/ask`, scope ? { scope } : {}, person);
  const job = await bridge.next();
  if (job) await bridge.answer(job.jobId, "Посмотрел.");
  const response = await asking;
  return { prompt: job ? `${job.system}\n${job.prompt}` : "", status: response.status };
}

describe("проекты", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`Стек не поднят (${BASE}/health). Запусти: make up`);
  });

  describe("агент не выносит закрытое", () => {
    it("зов по всему проекту не приносит из чата, которого позвавший не видит", async () => {
      const хозяин = await newPerson("Хозяин");
      const гость = await invite(хозяин, "Гость");
      const bridge = await connectBridge(гость);

      const проект = await newProject(хозяин, "Объект");
      const открытый = await newChannel(хозяин, "Смета");
      const закрытый = await newChannel(хозяин, "Деньги", "private");
      await toProject(хозяин, открытый.id, проект.id);
      await toProject(хозяин, закрытый.id, проект.id);

      await say(хозяин, открытый.id, "по смете вопросов нет");
      await say(хозяин, закрытый.id, `ставка ${ТАЙНА}`);

      await say(гость, открытый.id, `@${AGENT} что у нас по объекту?`);
      const { prompt } = await askAndCatchPrompt(гость, открытый.id, bridge, "project");

      expect(
        prompt,
        "в приглашение модели уехало содержимое чата, которого позвавший не видит",
      ).not.toContain(ТАЙНА);
      expect(prompt, "соседний ВИДИМЫЙ чат проекта в приглашение не попал").toContain("смете");
    });

    it("зов по проекту читает соседний чат, если он виден", async () => {
      const хозяин = await newPerson("Хозяин");
      const bridge = await connectBridge(хозяин);

      const проект = await newProject(хозяин, "Объект");
      const первый = await newChannel(хозяин, "Смета");
      const второй = await newChannel(хозяин, "Кровля");
      await toProject(хозяин, первый.id, проект.id);
      await toProject(хозяин, второй.id, проект.id);

      await say(хозяин, второй.id, "кровлю закрыли в четверг");
      await say(хозяин, первый.id, `@${AGENT} что по объекту?`);

      const { prompt } = await askAndCatchPrompt(хозяин, первый.id, bridge, "project");
      expect(prompt, "соседний чат проекта не прочитан").toContain("четверг");
    });

    it("чат вне проекта читается один, как и раньше", async () => {
      const хозяин = await newPerson("Хозяин");
      const bridge = await connectBridge(хозяин);

      const сам = await newChannel(хозяин, "Сам по себе");
      const соседний = await newChannel(хозяин, "Соседний");
      await say(хозяин, соседний.id, "посторонняя тема");
      await say(хозяин, сам.id, `@${AGENT} итог?`);

      const { prompt } = await askAndCatchPrompt(хозяин, сам.id, bridge, "project");
      expect(prompt, "чат без проекта притянул соседей").not.toContain("посторонняя");
    });
  });

  describe("проект не меняет прав", () => {
    it("приватный чат в общем проекте остаётся невидимым", async () => {
      const хозяин = await newPerson("Хозяин");
      const гость = await invite(хозяин, "Гость");

      const проект = await newProject(хозяин, "Объект");
      const открытый = await newChannel(хозяин, "Смета");
      const закрытый = await newChannel(хозяин, "Деньги", "private");
      await toProject(хозяин, открытый.id, проект.id);
      await toProject(хозяин, закрытый.id, проект.id);

      const видит = await conversations(гость);
      expect(
        видит.map((one) => one.id),
        "проект открыл гостю приватный чат",
      ).not.toContain(закрытый.id);
      expect(видит.find((one) => one.id === открытый.id)?.projectId).toBe(проект.id);
    });

    it("проект, все чаты которого закрыты, гостю не виден вовсе", async () => {
      const хозяин = await newPerson("Хозяин");
      const гость = await invite(хозяин, "Гость");

      const проект = await newProject(хозяин, "Только своё");
      const закрытый = await newChannel(хозяин, "Деньги", "private");
      await toProject(хозяин, закрытый.id, проект.id);

      expect(
        (await projects(гость)).map((one) => one.id),
        "гость видит проект, в котором ему не виден ни один чат",
      ).not.toContain(проект.id);
      expect(
        (await projects(хозяин)).map((one) => one.id),
        "хозяин потерял свой проект",
      ).toContain(проект.id);
    });

    it("чужой проект не отвечает ничем", async () => {
      const хозяин = await newPerson("Хозяин");
      const чужой = await newPerson("Чужой");
      const проект = await newProject(хозяин, "Объект");
      const свой = await newChannel(чужой, "Свой");

      const ответ = await toProject(чужой, свой.id, проект.id);
      expect(ответ.status, "чат отнесли к проекту другого пространства").toBe(404);
    });
  });

  describe("принадлежность", () => {
    it("одна: переезд в другой проект убирает из прежнего", async () => {
      const хозяин = await newPerson("Хозяин");
      const первый = await newProject(хозяин, "Первый");
      const второй = await newProject(хозяин, "Второй");
      const чат = await newChannel(хозяин, "Кочующий");

      await toProject(хозяин, чат.id, первый.id);
      await toProject(хозяин, чат.id, второй.id);

      const где = (await conversations(хозяин)).find((one) => one.id === чат.id);
      expect(где?.projectId, "чат остался в прежнем проекте").toBe(второй.id);
    });

    it("снятая принадлежность возвращает чат наружу", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");
      const чат = await newChannel(хозяин, "Смета");

      await toProject(хозяин, чат.id, проект.id);
      expect((await toProject(хозяин, чат.id, null)).status).toBe(200);

      const где = (await conversations(хозяин)).find((one) => one.id === чат.id);
      expect(где?.projectId, "чат не вышел из проекта").toBeNull();
    });

    it("чат заводится СРАЗУ в проекте, одним запросом", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");

      const ответ = await newChannelIn(хозяин, "Смета", проект.id);
      expect(ответ.status).toBe(201);
      const создан = (await ответ.json()) as Conversation;
      expect(создан.projectId, "заводка в проект вернула чат без принадлежности").toBe(проект.id);

      const где = (await conversations(хозяин)).find((one) => one.id === создан.id);
      expect(где?.projectId).toBe(проект.id);
    });

    it("чат в чужой проект не заводится", async () => {
      const хозяин = await newPerson("Хозяин");
      const чужой = await newPerson("Чужой");
      const проект = await newProject(хозяин, "Объект");

      const ответ = await newChannelIn(чужой, "Свой", проект.id);
      expect(ответ.status, "канал завели в проект другого пространства").toBe(404);
    });

    it("новый чат заводится вне проектов", async () => {
      const хозяин = await newPerson("Хозяин");
      const чат = await newChannel(хозяин, "Просто чат");
      const где = (await conversations(хозяин)).find((one) => one.id === чат.id);
      expect(где?.projectId).toBeNull();
    });
  });

  describe("переименование и удаление", () => {
    it("проект переименовывается", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");
      const чат = await newChannel(хозяин, "Смета");
      await toProject(хозяин, чат.id, проект.id);

      expect((await renameProject(хозяин, проект.id, "Второй объект")).status).toBe(200);
      const виден = (await projects(хозяин)).find((one) => one.id === проект.id);
      expect(виден?.title).toBe("Второй объект");
    });

    it("убрать проект — чаты живы и вне проектов", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");
      const первый = await newChannel(хозяин, "Смета");
      const второй = await newChannel(хозяин, "Кровля");
      await toProject(хозяин, первый.id, проект.id);
      await toProject(хозяин, второй.id, проект.id);
      await say(хозяин, первый.id, "важные слова");

      expect((await removeProject(хозяин, проект.id)).status).toBe(204);

      expect(
        (await projects(хозяин)).map((one) => one.id),
        "убранный проект остался в панели",
      ).not.toContain(проект.id);

      const список = await conversations(хозяин);
      for (const id of [первый.id, второй.id]) {
        const чат = список.find((one) => one.id === id);
        expect(чат, "чат исчез вместе с папкой — худшая трактовка слова «убрать»").toBeDefined();
        expect(чат?.projectId, "чат остался привязан к убранному проекту").toBeNull();
      }

      const лента = await get(`/v1/conversations/${первый.id}/messages`, хозяин);
      expect(лента.status, "переписка убранного проекта не читается").toBe(200);
      const тело = (await лента.json()) as { items: { body: string }[] };
      expect(тело.items.map((one) => one.body)).toContain("важные слова");
    });

    it("чужой проект не убрать и не переименовать", async () => {
      const хозяин = await newPerson("Хозяин");
      const чужой = await newPerson("Чужой");
      const проект = await newProject(хозяин, "Объект");

      expect((await removeProject(чужой, проект.id)).status).toBe(404);
      expect((await renameProject(чужой, проект.id, "моё")).status).toBe(404);
    });
  });
});
