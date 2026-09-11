/**
 * ПРИЁМОЧНЫЙ ТЕСТ МОСТА (task-001). Написан ДО кода и обязан быть красным.
 *
 * Мост — машина участника, на которой живёт ЕГО подписка. Соединение
 * открывает машина: у ноутбука нет открытого адреса, снаружи к нему
 * не подключиться. Поэтому мост сам приходит за работой и ждёт.
 *
 * Здесь мост поддельный — обычный HTTP-клиент, изображающий машину.
 * Подделка проверяет договор между сторонами и слепа на швах: установлен ли
 * клиент, выполнен ли в него вход, доходит ли сеть. Это добирается живым
 * прогоном, и подделка его НЕ заменяет.
 *
 * Вопросы к тестам — в dock/tasks/task-001-мост-участника.md §6.
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/** Сколько сервер ждёт ответа моста. Должно совпадать с настройкой стенда. */
const WAIT_MS = Number(process.env.AMPLIFIE_BRIDGE_WAIT_MS ?? 25_000);

function freshEmail(): string {
  return `bridge-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

async function person(tag: string): Promise<{ cookie: string }> {
  const registered = await fetch(`${BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
      workspaceName: `Пространство ${tag}`,
    }),
  });
  if (registered.status !== 201) throw new Error(`регистрация: ${registered.status}`);
  return { cookie: sessionCookie(registered) };
}

/** Выдать код подключения. Код показывается ОДИН раз — как приглашение. */
async function issueCode(cookie: string): Promise<{ id: string; code: string; command: string }> {
  const response = await fetch(`${BASE}/v1/bridges`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  if (response.status !== 201) throw new Error(`выдача кода: ${response.status}`);
  return (await response.json()) as { id: string; code: string; command: string };
}

/** Поддельный мост: то, что делала бы машина человека. */
function fakeBridge(token: string) {
  const headers = { "content-type": "application/json", authorization: `Bridge ${token}` };
  return {
    /** Прийти за работой. Ждёт до срока; пусто — значит работы не было. */
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
    failed(jobId: string, reason: string): Promise<Response> {
      return fetch(`${BASE}/v1/bridge/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, error: reason }),
      });
    },
  };
}

async function join(code: string, name: string): Promise<Response> {
  return fetch(`${BASE}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
}

/** Подключить поддельный мост целиком: код → токен → готовый клиент. */
async function connect(cookie: string, name: string) {
  const { code } = await issueCode(cookie);
  const joined = await join(code, name);
  if (joined.status !== 200) throw new Error(`подключение моста: ${joined.status}`);
  const { token } = (await joined.json()) as { token: string };
  return fakeBridge(token);
}

/** Спросить модель от лица человека — то, что делает кнопка «проверить». */
function ask(cookie: string, prompt: string): Promise<Response> {
  return fetch(`${BASE}/v1/model/check`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ prompt }),
  });
}

describe("мост участника", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("В-1 код подключения одноразовый", () => {
    it("два одновременных подключения одним кодом — успех ровно один", async () => {
      // Код даёт постоянный доступ от имени человека. Два моста по одному
      // коду — это чужая машина, отвечающая за него. Приём тот же, что
      // у приглашений, но таблица и запрос другие, поэтому проверяем заново.
      const svetlana = await person("Светлана");
      const { code } = await issueCode(svetlana.cookie);

      const [first, second] = await Promise.all([join(code, "ноутбук"), join(code, "рабочий")]);
      const successes = [first, second].filter((r) => r.status === 200);

      expect(successes).toHaveLength(1);
    });

    it("чужой код не даёт доступа: ответ неотличим от «такого кода нет»", async () => {
      const response = await join("код-которого-не-существует", "ноутбук");
      expect(response.status).toBe(404);
      // Именно НАШ отказ, а не «нет такого пути»: пока ручки не существует,
      // Fastify отдаёт ту же четыреста четвёртую, и тест зеленел бы впустую.
      expect(((await response.json()) as { error?: string }).error).toBe("not_found");
    });
  });

  describe("В-2 ответ приходит тому, кто спросил", () => {
    it("два человека спрашивают одновременно — ответы не перепутаны", async () => {
      const svetlana = await person("Светлана");
      const petr = await person("Пётр");
      const svetlanaBridge = await connect(svetlana.cookie, "ноутбук Светланы");
      const petrBridge = await connect(petr.cookie, "ноутбук Петра");

      const svetlanaQuestion = ask(svetlana.cookie, "кто я?");
      const petrQuestion = ask(petr.cookie, "кто я?");

      // Каждый мост отвечает своим словом. Перепутанные ответы означали бы,
      // что человек увидел чужой текст, — худший из возможных отказов.
      const svetlanaJob = await svetlanaBridge.next();
      const petrJob = await petrBridge.next();
      if (!svetlanaJob || !petrJob) throw new Error("мост не получил задание");
      await svetlanaBridge.answer(svetlanaJob.jobId, "Светлана");
      await petrBridge.answer(petrJob.jobId, "Пётр");

      const [svetlanaAnswer, petrAnswer] = await Promise.all([svetlanaQuestion, petrQuestion]);
      expect(((await svetlanaAnswer.json()) as { text: string }).text).toBe("Светлана");
      expect(((await petrAnswer.json()) as { text: string }).text).toBe("Пётр");
    });
  });

  describe("В-3 мост молчит", () => {
    it("моста нет вовсе — внятная причина, а не пятисотка", async () => {
      // Обычное состояние: человек ещё не подключился или закрыл терминал.
      const svetlana = await person("Светлана");
      const response = await ask(svetlana.cookie, "привет");

      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toBe("bridge_offline");
    });

    it(
      "мост взял задание и не ответил — срок выходит, вопрос не висит",
      async () => {
        const svetlana = await person("Светлана");
        const silentBridge = await connect(svetlana.cookie, "молчаливый");

        const startedAt = Date.now();
        const question = ask(svetlana.cookie, "привет");
        await silentBridge.next();

        const response = await question;
        expect(response.status).toBe(504);
        expect(Date.now() - startedAt).toBeLessThan(WAIT_MS * 2);
        // Тест намеренно ждёт весь срок: короче его не сделать, не сломав
        // то, что он проверяет. Отсюда и отдельный запас по времени.
      },
      WAIT_MS * 2,
    );

    it("мост честно сообщил об отказе — причина доезжает до человека", async () => {
      const svetlana = await person("Светлана");
      const silentBridge = await connect(svetlana.cookie, "сломанный");

      const question = ask(svetlana.cookie, "привет");
      const job = await silentBridge.next();
      if (!job) throw new Error("мост не получил задание");
      await silentBridge.failed(job.jobId, "клиент не установлен");

      const response = await question;
      expect(response.status).toBe(502);
      expect(((await response.json()) as { detail?: string }).detail).toContain(
        "клиент не установлен",
      );
    });
  });

  describe("В-4 удостоверения не смешиваются", () => {
    it("токеном моста нельзя ходить в интерфейс человека", async () => {
      const svetlana = await person("Светлана");
      const { code } = await issueCode(svetlana.cookie);
      const joined = await join(code, "ноутбук");
      const { token } = (await joined.json()) as { token: string };

      const response = await fetch(`${BASE}/v1/me`, {
        headers: { authorization: `Bridge ${token}` },
      });
      expect(response.status).toBe(401);
    });

    it("сессией браузера нельзя прийти за работой моста", async () => {
      const svetlana = await person("Светлана");
      const response = await fetch(`${BASE}/v1/bridge/next`, {
        headers: { cookie: svetlana.cookie },
      });
      expect(response.status).toBe(401);
    });
  });

  describe("В-5 ответ моста — недоверенный текст", () => {
    it("разметка и служебные последовательности доезжают как текст", async () => {
      // Мост присылает то, что породила модель, а модель читала ленту.
      // Это недоверенный ввод по определению: он не должен ни исполняться,
      // ни подменять поля ответа.
      const svetlana = await person("Светлана");
      const silentBridge = await connect(svetlana.cookie, "ноутбук");
      const dangerous = '<script>alert(1)</script> и {"text":"подмена"}';

      const question = ask(svetlana.cookie, "привет");
      const job = await silentBridge.next();
      if (!job) throw new Error("мост не получил задание");
      await silentBridge.answer(job.jobId, dangerous);

      const response = (await (await question).json()) as { text: string };
      expect(response.text).toBe(dangerous);
    });
  });

  describe("состояние моста видно человеку", () => {
    it("подключённый мост показан на связи, с именем машины", async () => {
      const svetlana = await person("Светлана");
      await connect(svetlana.cookie, "ноутбук Светланы");

      const list = (await (
        await fetch(`${BASE}/v1/bridges`, { headers: { cookie: svetlana.cookie } })
      ).json()) as { items: Array<{ name: string | null; online: boolean }> };

      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.name).toBe("ноутбук Светланы");
      expect(list.items[0]?.online).toBe(true);
    });

    it("выданный, но не погашенный код мостом не считается", async () => {
      // Иначе человек видит «мост есть», а спросить не может.
      const svetlana = await person("Светлана");
      await issueCode(svetlana.cookie);

      const list = (await (
        await fetch(`${BASE}/v1/bridges`, { headers: { cookie: svetlana.cookie } })
      ).json()) as { items: Array<{ online: boolean; joined: boolean }> };

      expect(list.items[0]?.joined).toBe(false);
      expect(list.items[0]?.online).toBe(false);
    });
  });
});
