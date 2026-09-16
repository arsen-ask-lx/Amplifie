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
/** Порт `api` напрямую, мимо Caddy: только стенд публикует его на петле. */
const API = process.env.AMPLIFIE_API_URL ?? "http://localhost:3477";

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
    const codes: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) codes.push(await tryLogin(email));

    expect(codes.slice(0, 5), "порог сработал раньше пятой попытки").toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(codes.at(-1), "седьмая попытка подбора прошла к проверке пароля").toBe(429);
  });

  it("П-2: порог входа не отнимает попытки у соседа по адресу", async () => {
    const first = freshEmail("neighbour-a");
    const second = freshEmail("neighbour-b");

    // Первый израсходовал свои попытки целиком.
    for (let attempt = 0; attempt < 7; attempt++) await tryLogin(first);
    expect(await tryLogin(first)).toBe(429);

    // ⚠️ ВТОРОЙ ПРИХОДИТ С ТОГО ЖЕ АДРЕСА. Если ключ порога — адрес,
    // а не пара «почта и адрес», он получит 429 за чужие попытки.
    expect(
      await tryLogin(second),
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

  /**
   * П-6 (task-093, слой 1): выдуманная печенька на каждом запросе больше
   * не обходит порог и не гоняет проверку сессии в базу.
   *
   * ⚠️ СВОЙ АДРЕС, А НЕ ОБЩИЙ. Прямо в порт `api` из частной сети сервер
   * доверяет `X-Forwarded-For` (`trustProxy: "uniquelocal"`), поэтому
   * у этого теста свой адрес: его блок не заденет соседние файлы, которые
   * ходят с общего адреса стенда. Через Caddy подмена не проходит —
   * проверено живьём (журнал task-093).
   */
  it("П-6: поток выдуманных печенек упирается в барьер без похода в базу, а настоящая сессия проходит", async () => {
    const address = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    const direct = (path: string, cookie: string) =>
      fetch(`${API}${path}`, { headers: { cookie, "x-forwarded-for": address } });

    // Настоящий человек с того же адреса — сессию сервер подтвердил при входе.
    const registered = await fetch(`${API}/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": address },
      body: JSON.stringify({
        email: freshEmail("nat-neighbour"),
        password: "очень-длинный-пароль-для-теста",
        displayName: "Сосед по NAT",
        workspaceName: "Барьер",
      }),
    });
    const real = sessionCookie(registered);

    let blocked: Response | null = null;
    for (let n = 0; n < 1000 && !blocked; n++) {
      const response = await direct(
        "/v1/sync?after=0",
        `amplifie_session=made-up-${crypto.randomUUID()}`,
      );
      if (response.status === 429) blocked = response;
      await response.arrayBuffer();
    }

    expect(blocked, "тысяча выдуманных печенек прошла к проверке сессии").not.toBeNull();
    expect(blocked?.headers.get("x-db-queries"), "отказ барьера сходил в базу").toBe("0");
    expect(blocked?.headers.get("retry-after")).not.toBeNull();

    const neighbour = await direct("/v1/sync?after=0", real);
    expect(neighbour.status, "настоящую сессию наказали за чужие выдуманные печеньки").toBe(200);
  });

  it("П-7: две сессии одного человека делят один порог отправки", async () => {
    const email = freshEmail("two-sessions");
    const password = "очень-длинный-пароль-для-теста";
    const first = await post("/v1/auth/register", {
      email,
      password,
      displayName: "Два входа",
      workspaceName: "Две сессии",
    });
    const cookieA = sessionCookie(first);
    const cookieB = sessionCookie(await post("/v1/auth/login", { email, password }));
    const rooms = await get("/v1/conversations", cookieA);
    const room = ((await rooms.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    if (!room) throw new Error("у нового пространства нет канала");

    const say = async (cookie: string, n: number) =>
      (
        await post(
          `/v1/conversations/${room}/messages`,
          { body: `строка ${n}`, clientMsgId: crypto.randomUUID() },
          cookie,
        )
      ).status;

    for (let n = 0; n < 20; n++) expect(await say(cookieA, n)).toBe(201);

    let fromSecond = 0;
    for (let n = 0; n < 30; n++) {
      if ((await say(cookieB, n)) === 429) break;
      fromSecond += 1;
    }
    expect(
      fromSecond,
      "вторая сессия получила свой порог — считается печенька, а не человек",
    ).toBeLessThanOrEqual(10);
  });

  it("П-4: порог отправки считается по человеку, а не по адресу", async () => {
    // Двое РАЗНЫХ людей с одного адреса: у каждого свой счётчик.
    const first = await post("/v1/auth/register", {
      email: freshEmail("sender-a"),
      password: "очень-длинный-пароль-для-теста",
      displayName: "Первый",
      workspaceName: "Отправка А",
    });
    const second = await post("/v1/auth/register", {
      email: freshEmail("sender-b"),
      password: "очень-длинный-пароль-для-теста",
      displayName: "Второй",
      workspaceName: "Отправка Б",
    });
    const cookieA = sessionCookie(first);
    const cookieB = sessionCookie(second);

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

    let firstHitLimit = false;
    for (let n = 0; n < 35 && !firstHitLimit; n++) {
      firstHitLimit = (await say(roomA, cookieA, n)) === 429;
    }
    expect(firstHitLimit, "отправка ничем не ограничена").toBe(true);

    expect(
      await say(roomB, cookieB, 1),
      "второй человек наказан за поток первого — значит порог считается по адресу",
    ).toBe(201);
  });
});
