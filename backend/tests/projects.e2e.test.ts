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
import { BASE, call, colleague, newPerson, type Person, requireStand } from "./stand.js";

const AGENT = "memo";

/**
 * Слово-маркер из закрытого чата.
 *
 * Редкое нарочно: если оно окажется в приглашении, это не совпадение
 * и не общая фраза, а именно та реплика.
 */
const SECRET_WORD = "криптоквазиморфный";

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

const get = (path: string, person?: Person) => call("GET", path, person);
const post = (path: string, body: unknown, person?: Person) => call("POST", path, person, body);
const patch = (path: string, body: unknown, person: Person) => call("PATCH", path, person, body);

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

function removeProject(person: Person, id: string): Promise<Response> {
  return call("DELETE", `/v1/projects/${id}`, person);
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
  beforeAll(requireStand);

  describe("агент не выносит закрытое", () => {
    it("зов по всему проекту не приносит из чата, которого позвавший не видит", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await colleague(owner, "Гость");
      const bridge = await connectBridge(guest);

      const project = await newProject(owner, "Объект");
      const open = await newChannel(owner, "Смета");
      const nearby = await newChannel(owner, "Кровля");
      const closed = await newChannel(owner, "Деньги", "private");
      await toProject(owner, open.id, project.id);
      await toProject(owner, nearby.id, project.id);
      await toProject(owner, closed.id, project.id);

      await say(owner, open.id, "по смете вопросов нет");
      await say(owner, nearby.id, "кровлю закрыли в четверг");
      await say(owner, closed.id, `ставка ${SECRET_WORD}`);

      await say(guest, open.id, `@${AGENT} что у нас по объекту?`);
      const { prompt } = await askAndCatchPrompt(guest, open.id, bridge, "project");

      expect(
        prompt,
        "в приглашение модели уехало содержимое чата, которого позвавший не видит",
      ).not.toContain(SECRET_WORD);
      // Положительный контроль: зов прочитал и свой чат, и соседний видимый —
      // значит проект читался целиком, а тайна отсеяна правом, а не пустотой.
      expect(prompt, "чат, где позвали, в приглашение не попал").toContain("смете");
      expect(prompt, "соседний ВИДИМЫЙ чат проекта в приглашение не попал").toContain("четверг");
    });

    it("зов по проекту читает соседний чат, если он виден", async () => {
      const owner = await newPerson("Хозяин");
      const bridge = await connectBridge(owner);

      const project = await newProject(owner, "Объект");
      const first = await newChannel(owner, "Смета");
      const second = await newChannel(owner, "Кровля");
      await toProject(owner, first.id, project.id);
      await toProject(owner, second.id, project.id);

      await say(owner, second.id, "кровлю закрыли в четверг");
      await say(owner, first.id, `@${AGENT} что по объекту?`);

      const { prompt } = await askAndCatchPrompt(owner, first.id, bridge, "project");
      expect(prompt, "соседний чат проекта не прочитан").toContain("четверг");
    });

    it("чат вне проекта читается один, как и раньше", async () => {
      const owner = await newPerson("Хозяин");
      const bridge = await connectBridge(owner);

      const loose = await newChannel(owner, "Сам по себе");
      const nearby = await newChannel(owner, "Соседний");
      await say(owner, nearby.id, "посторонняя тема");
      await say(owner, loose.id, `@${AGENT} итог?`);

      const { prompt } = await askAndCatchPrompt(owner, loose.id, bridge, "project");
      expect(prompt, "чат без проекта притянул соседей").not.toContain("посторонняя");
    });
  });

  describe("проект не меняет прав", () => {
    it("приватный чат в общем проекте остаётся невидимым", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await colleague(owner, "Гость");

      const project = await newProject(owner, "Объект");
      const open = await newChannel(owner, "Смета");
      const closed = await newChannel(owner, "Деньги", "private");
      await toProject(owner, open.id, project.id);
      await toProject(owner, closed.id, project.id);

      const visible = await conversations(guest);
      expect(
        visible.map((one) => one.id),
        "проект открыл гостю приватный чат",
      ).not.toContain(closed.id);
      expect(visible.find((one) => one.id === open.id)?.projectId).toBe(project.id);
    });

    it("проект, все чаты которого закрыты, гостю не виден вовсе", async () => {
      const owner = await newPerson("Хозяин");
      const guest = await colleague(owner, "Гость");

      const project = await newProject(owner, "Только своё");
      const closed = await newChannel(owner, "Деньги", "private");
      await toProject(owner, closed.id, project.id);

      expect(
        (await projects(guest)).map((one) => one.id),
        "гость видит проект, в котором ему не виден ни один чат",
      ).not.toContain(project.id);
      expect(
        (await projects(owner)).map((one) => one.id),
        "хозяин потерял свой проект",
      ).toContain(project.id);
    });

    it("чужой проект не отвечает ничем", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужой");
      const project = await newProject(owner, "Объект");
      const own = await newChannel(stranger, "Свой");

      const response = await toProject(stranger, own.id, project.id);
      expect(response.status, "чат отнесли к проекту другого пространства").toBe(404);
    });
  });

  describe("принадлежность", () => {
    it("одна: переезд в другой проект убирает из прежнего", async () => {
      const owner = await newPerson("Хозяин");
      const first = await newProject(owner, "Первый");
      const second = await newProject(owner, "Второй");
      const chat = await newChannel(owner, "Кочующий");

      await toProject(owner, chat.id, first.id);
      await toProject(owner, chat.id, second.id);

      const moved = (await conversations(owner)).find((one) => one.id === chat.id);
      expect(moved?.projectId, "чат остался в прежнем проекте").toBe(second.id);
    });

    it("снятая принадлежность возвращает чат наружу", async () => {
      const owner = await newPerson("Хозяин");
      const project = await newProject(owner, "Объект");
      const chat = await newChannel(owner, "Смета");

      await toProject(owner, chat.id, project.id);
      expect((await toProject(owner, chat.id, null)).status).toBe(200);

      const moved = (await conversations(owner)).find((one) => one.id === chat.id);
      expect(moved?.projectId, "чат не вышел из проекта").toBeNull();
    });

    it("чат заводится СРАЗУ в проекте, одним запросом", async () => {
      const owner = await newPerson("Хозяин");
      const project = await newProject(owner, "Объект");

      const response = await newChannelIn(owner, "Смета", project.id);
      expect(response.status).toBe(201);
      const created = (await response.json()) as Conversation;
      expect(created.projectId, "заводка в проект вернула чат без принадлежности").toBe(project.id);

      const moved = (await conversations(owner)).find((one) => one.id === created.id);
      expect(moved?.projectId).toBe(project.id);
    });

    it("чат в чужой проект не заводится", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужой");
      const project = await newProject(owner, "Объект");

      const response = await newChannelIn(stranger, "Свой", project.id);
      expect(response.status, "канал завели в проект другого пространства").toBe(404);
    });

    it("новый чат заводится вне проектов", async () => {
      const owner = await newPerson("Хозяин");
      const chat = await newChannel(owner, "Просто чат");
      const moved = (await conversations(owner)).find((one) => one.id === chat.id);
      expect(moved?.projectId).toBeNull();
    });
  });

  describe("переименование и удаление", () => {
    it("проект переименовывается", async () => {
      const owner = await newPerson("Хозяин");
      const project = await newProject(owner, "Объект");
      const chat = await newChannel(owner, "Смета");
      await toProject(owner, chat.id, project.id);

      expect((await renameProject(owner, project.id, "Второй объект")).status).toBe(200);
      const shown = (await projects(owner)).find((one) => one.id === project.id);
      expect(shown?.title).toBe("Второй объект");
    });

    it("убрать проект — чаты живы и вне проектов", async () => {
      const owner = await newPerson("Хозяин");
      const project = await newProject(owner, "Объект");
      const first = await newChannel(owner, "Смета");
      const second = await newChannel(owner, "Кровля");
      await toProject(owner, first.id, project.id);
      await toProject(owner, second.id, project.id);
      await say(owner, first.id, "важные слова");

      expect((await removeProject(owner, project.id)).status).toBe(204);

      expect(
        (await projects(owner)).map((one) => one.id),
        "убранный проект остался в панели",
      ).not.toContain(project.id);

      const list = await conversations(owner);
      for (const id of [first.id, second.id]) {
        const chat = list.find((one) => one.id === id);
        expect(chat?.id, "чат исчез вместе с папкой — худшая трактовка слова «убрать»").toBe(id);
        expect(chat?.projectId, "чат остался привязан к убранному проекту").toBeNull();
      }

      const feed = await get(`/v1/conversations/${first.id}/messages`, owner);
      expect(feed.status, "переписка убранного проекта не читается").toBe(200);
      const body = (await feed.json()) as { items: { body: string }[] };
      expect(body.items.map((one) => one.body)).toContain("важные слова");
    });

    it("чужой проект не убрать и не переименовать", async () => {
      const owner = await newPerson("Хозяин");
      const stranger = await newPerson("Чужой");
      const project = await newProject(owner, "Объект");

      expect((await removeProject(stranger, project.id)).status).toBe(404);
      expect((await renameProject(stranger, project.id, "моё")).status).toBe(404);
    });
  });

  describe("вид: цвет проверяется на границе (перенесено из браузерного project-look, task-125)", () => {
    it("сервер принимает только цвет, а не имя", async () => {
      const owner = await newPerson("Хозяин");
      const project = await newProject(owner, "Вид");

      const name = await patch(`/v1/projects/${project.id}`, { color: "красный" }, owner);
      expect(name.status, "сервер принял имя цвета").toBe(422);
      const nameBody = (await name.json()) as { error: string; fields: Record<string, string> };
      expect(nameBody.error).toBe("validation_failed");
      expect(nameBody.fields.color).toBe("цвет записывается как #rrggbb строчными буквами");

      const junk = await patch(`/v1/projects/${project.id}`, { color: "#zzz" }, owner);
      expect(junk.status, "сервер принял не цвет").toBe(422);
      const junkBody = (await junk.json()) as { fields: Record<string, string> };
      expect(junkBody.fields.color).toBe("цвет записывается как #rrggbb строчными буквами");

      const ok = await patch(`/v1/projects/${project.id}`, { color: "#3a7bd5" }, owner);
      expect(ok.status, "сервер не принял настоящий цвет").toBe(200);
      const okBody = (await ok.json()) as { id: string };
      expect(okBody.id).toBe(project.id);
    });
  });
});
