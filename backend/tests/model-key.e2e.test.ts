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

/** Второй участник ТОГО ЖЕ пространства — через приглашение. */
async function inviteInto(host: Person, tag: string): Promise<Person> {
  const issued = await fetch(`${BASE}/v1/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: host.cookie },
    body: "{}",
  });
  if (issued.status !== 201) throw new Error(`приглашение: ${issued.status}`);
  const { token } = (await issued.json()) as { token: string };

  const joined = await fetch(`${BASE}/v1/auth/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
    }),
  });
  if (joined.status !== 201) throw new Error(`вход по приглашению: ${joined.status}`);
  return { cookie: sessionCookie(joined) };
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

    it("сосед по пространству видит СВОЙ источник, а не чужой", async () => {
      const host = await newPerson("Хозяин");
      const guest = await inviteInto(host, "Гость");

      await saveKey(host, markedKey("ХОЗЯИНА"));
      await saveKey(guest, markedKey("ГОСТЯ"));

      const hostVia = (await (await call("/v1/agents", host)).json()) as {
        answersVia: { hint: string };
      };
      const guestVia = (await (await call("/v1/agents", guest)).json()) as {
        answersVia: { hint: string };
      };

      expect(hostVia.answersVia.hint).toBe(markedKey("ХОЗЯИНА").slice(-4));
      expect(guestVia.answersVia.hint).toBe(markedKey("ГОСТЯ").slice(-4));
      expect(hostVia.answersVia.hint).not.toBe(guestVia.answersVia.hint);
    });

    it("общий ключ пространства работает, пока своего нет", async () => {
      const host = await newPerson("Заводящий");
      const guest = await inviteInto(host, "Безключевой");

      // Законная замена «поделиться подпиской»: делится ключ, не подписка.
      const shared = await saveKey(host, markedKey("ОБЩИЙ"), "пространство");
      expect(shared.status).toBe(201);

      const seen = (await (await call("/v1/agents", guest)).json()) as {
        answersVia: { kind: string; hint: string };
      };
      expect(seen.answersVia.kind).toBe("ключ пространства");
      expect(seen.answersVia.hint).toBe(markedKey("ОБЩИЙ").slice(-4));
    });
  });

  describe("В-5 чужой ключ недоступен", () => {
    it("участник не видит ключей соседа", async () => {
      const host = await newPerson("Первый");
      const guest = await inviteInto(host, "Второй");
      await saveKey(host, markedKey("ТОЛЬКОПЕРВОГО"));

      const mine = await keysOf(guest);
      expect(mine.filter((one) => one.scope === "участник")).toHaveLength(0);

      const seen = await everythingSeenBy(guest);
      expect(seen).not.toContain("ТОЛЬКОПЕРВОГО");
    });

    it("чужой ключ нельзя убрать", async () => {
      const host = await newPerson("Владелец ключа");
      const guest = await inviteInto(host, "Посторонний");
      await saveKey(host, markedKey("НЕТРОГАЙ"));

      const [key] = await keysOf(host);
      if (!key) throw new Error("ключ не сохранился");

      const removed = await call(`/v1/model-keys/${key.id}`, guest, { method: "DELETE" });
      expect(removed.status).toBe(404);

      // И он остался на месте.
      expect(await keysOf(host)).toHaveLength(1);
    });
  });

  describe("форма ключа проверяется до сохранения", () => {
    it("мусор вместо ключа не сохраняется", async () => {
      const person = await newPerson("Ошибающийся");
      const bad = await saveKey(person, "просто текст");
      expect(bad.status).toBe(422);
      expect(await keysOf(person)).toHaveLength(0);
    });
  });
});
