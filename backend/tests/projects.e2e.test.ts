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

/** Название проекта, который заводится при регистрации (task-037). */
const ДОМ = "Общее";

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

/**
 * Проект, который человек получил при регистрации (task-037).
 *
 * ⚠️ ЧАТУ БОЛЬШЕ НЕГДЕ ЖИТЬ, КРОМЕ ПРОЕКТА, поэтому у каждого теста
 * должен быть дом. Регистрация его и заводит — брать его здесь честнее,
 * чем заводить в каждом тесте свой: так проверка идёт по тому же пути,
 * что и живой человек.
 */
async function дом(person: Person): Promise<string> {
  const свой = (await projects(person)).find((one) => one.title === ДОМ);
  if (!свой) throw new Error(`после регистрации нет проекта «${ДОМ}»`);
  return свой.id;
}

/**
 * Завести чат. `projectId` не указан — в домашнем проекте регистрации.
 *
 * ⚠️ ПРОЕКТ ОБЯЗАТЕЛЕН НА УРОВНЕ ЗАПРОСА, а не подставляется сервером:
 * иначе «завести чат неизвестно куда» осталось бы возможным, и первая же
 * забытая передача завела бы невидимку.
 */
async function newChannel(
  person: Person,
  title: string,
  visibility?: "workspace" | "private",
  projectId?: string,
): Promise<Conversation> {
  const где = projectId ?? (await дом(person));
  const response = await post(
    "/v1/conversations",
    visibility ? { title, visibility, projectId: где } : { title, projectId: где },
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

    /**
     * ⚠️ «ВНЕ ПРОЕКТА» БОЛЬШЕ НЕ БЫВАЕТ (task-037), и проверять надо
     * соседнее свойство: область не перепрыгивает границу папки.
     * Чат один в своём проекте — значит читается один, как до Р-032.
     */
    it("чат, один в своём проекте, читается один", async () => {
      const хозяин = await newPerson("Хозяин");
      const bridge = await connectBridge(хозяин);

      const свой = await newProject(хозяин, "Отдельно");
      const сам = await newChannel(хозяин, "Сам по себе", undefined, свой.id);
      const соседний = await newChannel(хозяин, "Соседний");
      await say(хозяин, соседний.id, "посторонняя тема");
      await say(хозяин, сам.id, `@${AGENT} итог?`);

      const { prompt } = await askAndCatchPrompt(хозяин, сам.id, bridge, "project");
      expect(prompt, "область вышла за границу своего проекта").not.toContain("посторонняя");
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

    /**
     * ⚠️ ПРЕЖДЕ ЭТОТ ТЕСТ ТРЕБОВАЛ ОБРАТНОГО — «снятая принадлежность
     * возвращает чат наружу». Наружу больше нет: раздел «Каналы» убран
     * (task-037), и чат без проекта нельзя ни увидеть, ни открыть.
     * Разрешить снятие значило бы завести способ потерять переписку
     * одним запросом.
     */
    it("принадлежность нельзя снять — вне проекта чату негде жить", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");
      const чат = await newChannel(хозяин, "Смета");

      await toProject(хозяин, чат.id, проект.id);
      // 422 — тот же отказ, что и на канал без названия: наш разбор
      // тела отвечает им на всякую негодную форму запроса.
      expect((await toProject(хозяин, чат.id, null)).status, "чат выпустили из проектов").toBe(422);

      const где = (await conversations(хозяин)).find((one) => one.id === чат.id);
      expect(где?.projectId, "чат всё же вышел из проекта").toBe(проект.id);
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

    it("чат без проекта не заводится вовсе", async () => {
      const хозяин = await newPerson("Хозяин");
      const ответ = await post("/v1/conversations", { title: "Ничей" }, хозяин);
      expect(ответ.status, "завёлся чат, которого негде показать").toBe(422);
    });

    it("регистрация даёт проект и живой чат внутри него", async () => {
      const новичок = await newPerson("Новичок");

      const свои = await projects(новичок);
      expect(
        свои.map((one) => one.title),
        "пустое пространство без проекта — экран, на котором нечего делать",
      ).toContain(ДОМ);

      const чаты = await conversations(новичок);
      expect(чаты.length, "после регистрации не видно ни одного чата").toBeGreaterThan(0);
      for (const чат of чаты) {
        expect(чат.projectId, `чат «${чат.title}» лежит вне проекта — его негде показать`).not.toBe(
          null,
        );
      }
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

    /**
     * ⚠️ ПРЕЖДЕ ЭТОТ ТЕСТ ТРЕБОВАЛ ОБРАТНОГО — «чаты живы и вне
     * проектов». Пока домов было два, это была верная трактовка слова
     * «убрать»: папка исчезала, переписка оставалась. Дом остался один
     * (task-037), и та же трактовка теперь означает «чаты пропали
     * из панели навсегда» — то есть худшее из двух.
     *
     * Владелец 10.09 выбрал явное: убираем вместе с чатами, число
     * чатов называется в вопросе, удаление мягкое.
     */
    it("убрать проект — чаты уходят вместе с ним", async () => {
      const хозяин = await newPerson("Хозяин");
      const проект = await newProject(хозяин, "Объект");
      const первый = await newChannel(хозяин, "Смета", undefined, проект.id);
      const второй = await newChannel(хозяин, "Кровля", undefined, проект.id);
      await say(хозяин, первый.id, "важные слова");

      expect((await removeProject(хозяин, проект.id)).status).toBe(204);

      expect(
        (await projects(хозяин)).map((one) => one.id),
        "убранный проект остался в панели",
      ).not.toContain(проект.id);

      const список = await conversations(хозяин);
      for (const id of [первый.id, второй.id]) {
        expect(
          список.find((one) => one.id === id),
          "чат пережил свою папку и стал невидимкой: показать его негде",
        ).toBeUndefined();
      }
    });

    it("убранный проект не уносит чужие чаты", async () => {
      const хозяин = await newPerson("Хозяин");
      const убираемый = await newProject(хозяин, "Объект");
      const свой = await newChannel(хозяин, "Смета", undefined, убираемый.id);
      const чужой = await newChannel(хозяин, "Соседний");

      expect((await removeProject(хозяин, убираемый.id)).status).toBe(204);

      const список = await conversations(хозяин);
      expect(список.find((one) => one.id === свой.id)).toBeUndefined();
      expect(
        список.find((one) => one.id === чужой.id),
        "удаление папки унесло чат из ДРУГОГО проекта",
      ).toBeDefined();
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
