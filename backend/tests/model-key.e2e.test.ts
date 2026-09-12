/**
 * ПРИЁМОЧНЫЙ ТЕСТ: свой ключ модели у участника (task-008).
 * Написан ДО кода и обязан быть красным.
 *
 * ГЛАВНОЕ ЗДЕСЬ — НЕ «РАБОТАЕТ ЛИ», А «НЕ УТЁК ЛИ». Ключ, попавший
 * в ответ ручки или в лог, утёк навсегда: отозвать его может только
 * человек у поставщика. Поэтому тест не верит на слово, а ИЩЕТ приметную
 * строку во всех ответах раздела.
 *
 * Вопросы к тестам — dock/tasks/task-008-ключ-участника.md §6.
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/** Приметная середина: её и ищем в ответах. Хвост уходит в подсказку. */
function markedKey(mark: string): string {
  return `sk-ant-api03-${mark}-хвостик${mark.slice(0, 2)}`;
}

interface Person {
  cookie: string;
}

interface KeyView {
  id: string;
  provider: string;
  /** Последние знаки — чтобы человек узнал свой ключ. Не сам ключ. */
  hint: string;
  scope: "участник" | "пространство";
}

function freshEmail(): string {
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
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
  // content-type только там, где есть тело: Fastify отвергает пустой запрос
  // с заголовком JSON, и настоящий браузер его тоже не ставит.
  const headers: Record<string, string> = { cookie: person.cookie };
  if (init.body) headers["content-type"] = "application/json";
  return fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

function saveKey(person: Person, key: string, scope = "участник"): Promise<Response> {
  return call("/v1/model-keys", person, {
    method: "POST",
    body: JSON.stringify({ provider: "anthropic", key, scope }),
  });
}

async function keysOf(person: Person): Promise<KeyView[]> {
  const response = await call("/v1/model-keys", person);
  if (!response.ok) throw new Error(`список ключей: ${response.status}`);
  return ((await response.json()) as { items: KeyView[] }).items;
}

/**
 * Всё, что раздел «Агенты» отдаёт наружу, одной строкой.
 * Ключ не должен встретиться ни в одном байте.
 */
async function everythingSeenBy(person: Person): Promise<string> {
  const paths = ["/v1/model-keys", "/v1/agents", "/v1/me", "/v1/bridges"];
  const parts = await Promise.all(
    paths.map(async (path) => {
      const response = await call(path, person);
      return `${path} ${response.status} ${await response.text()}`;
    }),
  );
  return parts.join("\n");
}

describe("свой ключ модели", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-1 ключ не выходит наружу", () => {
    it("сохранённый ключ не встречается ни в одном ответе", async () => {
      const person = await newPerson("Ключник");
      const secret = markedKey("ПРИМЕТАОДИН");

      const saved = await saveKey(person, secret);
      expect(saved.status).toBe(201);

      // Ответ самой ручки сохранения — тоже ответ.
      expect(await saved.clone().text()).not.toContain("ПРИМЕТАОДИН");

      const seen = await everythingSeenBy(person);
      expect(seen).not.toContain("ПРИМЕТАОДИН");
      expect(seen).not.toContain(secret);
    });

    it("вместо ключа отдаётся подсказка из последних знаков", async () => {
      const person = await newPerson("Подсказка");
      const secret = markedKey("ПРИМЕТАДВА");
      await saveKey(person, secret);

      const [saved] = await keysOf(person);
      expect(saved?.provider).toBe("anthropic");
      expect(saved?.hint).toBe(secret.slice(-4));
      expect(saved?.hint.length).toBeLessThanOrEqual(4);
    });
  });

  describe("В-2 каждый платит своим", () => {
    it("раздел «Агенты» говорит, чем ответит агент", async () => {
      const person = await newPerson("Спрашивающий");
      const before = await call("/v1/agents", person);
      expect(((await before.json()) as { answersVia: { kind: string } }).answersVia.kind).toBe(
        "нечем",
      );

      await saveKey(person, markedKey("СВОЙКЛЮЧ"));

      const after = await call("/v1/agents", person);
      const via = ((await after.json()) as { answersVia: { kind: string; hint: string | null } })
        .answersVia;
      expect(via.kind).toBe("свой ключ");
      expect(via.hint).toBe(markedKey("СВОЙКЛЮЧ").slice(-4));
    });
  });

  // ⚠️ В-5 «чужой ключ недоступен» УДАЛЁН вместе с приглашениями: проверка
  // требовала второго человека в том же пространстве, а другой двери
  // для него не было. Изоляция ключей в коде осталась, доказательства
  // у неё больше нет (2026-09-07).

  describe("форма ключа проверяется до сохранения", () => {
    it("мусор вместо ключа не сохраняется", async () => {
      const person = await newPerson("Ошибающийся");
      const bad = await saveKey(person, "просто текст");
      expect(bad.status).toBe(422);
      expect(await keysOf(person)).toHaveLength(0);
    });
  });
});
