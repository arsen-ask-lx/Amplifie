/**
 * ПРИЁМОЧНЫЙ ТЕСТ: у дверей есть порог (task-018, Р-025).
 * Написан ДО кода и обязан быть красным.
 *
 * ⚠️ ГЛАВНОЕ ЗДЕСЬ — НЕ «ПОРОГ ЕСТЬ», А «ПОРОГ НЕ НАКАЗЫВАЕТ СОСЕДА».
 * Запросы приходят в приложение из Caddy, и наивный счёт по адресу
 * посчитал бы всю компанию как одного человека: первые пятеро вошедших
 * съели бы порог на всех остальных. Продукт сломался бы ровно там, где
 * начинает работать, — при втором человеке.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

function freshEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  const value = header ? header.split(";")[0] : null;
  if (!value) throw new Error("нет печеньки сессии");
  return value;
}

/** Неверный пароль указанной почте. Возвращает код ответа. */
async function tryLogin(email: string): Promise<number> {
  const response = await post("/v1/auth/login", { email, password: "заведомо-неверный-пароль" });
  return response.status;
}

describe("пороги у дверей", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`стек не поднят (${health.status}) — сначала make up`);
  });

  it("П-1: подбор пароля упирается в порог", async () => {
    const email = freshEmail("brute");

    // ⚠️ ПО ОЧЕРЕДИ, А НЕ ПАЧКОЙ. Порог считает попытки, и порядок здесь
    // важен: нам нужно увидеть, что ПЕРВЫЕ проходят до проверки пароля,
    // а поздние — уже нет.
    const коды: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) коды.push(await tryLogin(email));

    expect(коды.slice(0, 5), "порог сработал раньше пятой попытки").toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(коды.at(-1), "седьмая попытка подбора прошла к проверке пароля").toBe(429);
  });

  it("П-2: порог входа не отнимает попытки у соседа по адресу", async () => {
    const первый = freshEmail("neighbour-a");
    const второй = freshEmail("neighbour-b");

    // Первый израсходовал свои попытки целиком.
    for (let attempt = 0; attempt < 7; attempt++) await tryLogin(первый);
    expect(await tryLogin(первый)).toBe(429);

    // ⚠️ ВТОРОЙ ПРИХОДИТ С ТОГО ЖЕ АДРЕСА. Если ключ порога — адрес,
    // а не пара «почта и адрес», он получит 429 за чужие попытки.
    expect(
      await tryLogin(второй),
      "сосед по общему выходу в интернет потерял свои попытки из-за чужого подбора",
    ).toBe(401);
  });

  /**
   * ⚠️ ПРОВЕРКИ НА ПОРОГ ПРИГЛАШЕНИЯ ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ.
   *
   * Её ключ — адрес, а на стенде все приёмочные приходят с одного:
   * боевое число (30 в минуту) они выбрали бы сами, между делом, и тест
   * краснел бы через раз от соседних файлов. Поэтому у порогов, чей ключ
   * адрес — общий потолок, регистрация и вход по приглашению, — на стенде
   * стоят другие числа, и приёмочными они не проверяются.
   *
   * Проверяются те, чей ключ человек или почта: подбор пароля (П-1, П-2)
   * и поток отправки (П-4). Это и есть двери, за которыми что-то можно
   * УГАДАТЬ; остальные три сторожат расход, а не догадки.
   */

  it("П-5: отказ по порогу говорит, сколько ждать", async () => {
    const email = freshEmail("retry");
    let last: Response | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      last = await post("/v1/auth/login", { email, password: "заведомо-неверный-пароль" });
    }
    expect(last?.status).toBe(429);
    expect(
      last?.headers.get("retry-after"),
      "клиенту не сказано, когда возвращаться",
    ).not.toBeNull();
  });

  it("П-4: порог отправки считается по человеку, а не по адресу", async () => {
    // Двое РАЗНЫХ людей с одного адреса: у каждого свой счётчик.
    const первый = await post("/v1/auth/register", {
      email: freshEmail("sender-a"),
      password: "очень-длинный-пароль-для-теста",
      displayName: "Первый",
      workspaceName: "Отправка А",
    });
    const второй = await post("/v1/auth/register", {
      email: freshEmail("sender-b"),
      password: "очень-длинный-пароль-для-теста",
      displayName: "Второй",
      workspaceName: "Отправка Б",
    });
    const cookieA = sessionCookie(первый);
    const cookieB = sessionCookie(второй);

    const roomOf = async (cookie: string): Promise<string> => {
      const rooms = await get("/v1/conversations", cookie);
      const list = (await rooms.json()) as { items: Array<{ id: string }> };
      const first = list.items[0];
      if (!first) throw new Error("у нового пространства нет канала");
      return first.id;
    };
    const roomA = await roomOf(cookieA);
    const roomB = await roomOf(cookieB);

    const say = async (room: string, cookie: string, n: number): Promise<number> => {
      const response = await post(
        `/v1/conversations/${room}/messages`,
        { body: `строка ${n}`, clientMsgId: crypto.randomUUID() },
        cookie,
      );
      return response.status;
    };

    let первыйУпёрся = false;
    for (let n = 0; n < 35 && !первыйУпёрся; n++) {
      первыйУпёрся = (await say(roomA, cookieA, n)) === 429;
    }
    expect(первыйУпёрся, "отправка ничем не ограничена").toBe(true);

    expect(
      await say(roomB, cookieB, 1),
      "второй человек наказан за поток первого — значит порог считается по адресу",
    ).toBe(201);
  });
});
