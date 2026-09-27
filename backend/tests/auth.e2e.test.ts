/**
 * ПРИЁМОЧНЫЙ ТЕСТ СРЕЗА «ВХОД». Написан ДО кода и обязан быть красным.
 *
 * Бьёт по живому стеку через Caddy на реальном порту — так же, как это делает
 * браузер. Проверяет ПОВЕДЕНИЕ, а не внутренности: подкрутить его, не сделав
 * работу, нельзя.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, freshEmail, requireStand, sessionCookie } from "./stand.js";

/**
 * Печенька сессии целиком: имя и 32 случайных байта в base64url (43 знака).
 * Проверяется форма, а не «что-то есть»: пустое или обрезанное значение
 * тоже было бы «чем-то».
 */
const SESSION_COOKIE = /^amplifie_session=[A-Za-z0-9_-]{43}$/;

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

describe("вход на платформу", () => {
  beforeAll(requireStand);

  it("регистрация создаёт пространство, лицо и сессию", async () => {
    const email = freshEmail("reg");
    const response = await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Арсен",
      workspaceName: "Amplifie",
    });

    expect(response.status).toBe(201);
    expect(sessionCookie(response)).toMatch(SESSION_COOKIE);

    const body = (await response.json()) as { participant: { displayName: string } };
    expect(body.participant.displayName).toBe("Арсен");
  });

  it("после регистрации /v1/me отдаёт того, кто вошёл", async () => {
    const email = freshEmail("me");
    const registered = await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Пётр",
      workspaceName: "Пространство Петра",
    });
    const cookie = sessionCookie(registered);
    expect(cookie).toMatch(SESSION_COOKIE);

    const me = await get("/v1/me", cookie);
    expect(me.status).toBe(200);

    const body = (await me.json()) as {
      account: { email: string };
      participant: { displayName: string; kind: string; role: string };
      workspace: { name: string };
    };
    expect(body.account.email).toBe(email.toLowerCase());
    expect(body.participant.displayName).toBe("Пётр");
    expect(body.participant.kind).toBe("human");
    expect(body.participant.role).toBe("owner");
    expect(body.workspace.name).toBe("Пространство Петра");
  });

  it("без сессии /v1/me отвечает 401", async () => {
    const response = await get("/v1/me");
    expect(response.status).toBe(401);
  });

  it("почта нечувствительна к регистру и не даёт завести двойника", async () => {
    const email = freshEmail("dup");
    const first = await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Первый",
      workspaceName: "Первое",
    });
    expect(first.status).toBe(201);

    const second = await post("/v1/auth/register", {
      email: email.toUpperCase(),
      password: "другой-пароль-совсем",
      displayName: "Второй",
      workspaceName: "Второе",
    });
    expect(second.status).toBe(409);
  });

  it("вход неверным паролем не пускает и не выдаёт, есть ли такая почта", async () => {
    const email = freshEmail("bad");
    await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Кто-то",
      workspaceName: "Чьё-то",
    });

    const wrongPassword = await post("/v1/auth/login", { email, password: "неверный" });
    const noSuchEmail = await post("/v1/auth/login", {
      email: freshEmail("ghost"),
      password: "неверный",
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchEmail.status).toBe(401);
    // Ответ обязан быть одинаковым — иначе по нему перебирают, кто зарегистрирован.
    expect(await wrongPassword.json()).toEqual(await noSuchEmail.json());
  });

  it("вход верным паролем выдаёт рабочую сессию", async () => {
    const email = freshEmail("ok");
    await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Мария",
      workspaceName: "Пространство Марии",
    });

    const login = await post("/v1/auth/login", {
      email,
      password: "правильный-конский-скотч-батарейка",
    });
    expect(login.status).toBe(200);

    const cookie = sessionCookie(login);
    const me = await get("/v1/me", cookie);
    expect(me.status).toBe(200);
  });

  it("выход гасит сессию, и старая печенька больше не работает", async () => {
    const email = freshEmail("out");
    const registered = await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Ушедший",
      workspaceName: "Опустевшее",
    });
    const cookie = sessionCookie(registered);

    const logout = await post("/v1/auth/logout", {}, cookie);
    expect(logout.status).toBe(204);

    const afterLogout = await get("/v1/me", cookie);
    expect(afterLogout.status).toBe(401);
  });

  it("подделанная печенька не пускает", async () => {
    // Значение только из latin-1: заголовок cookie — ByteString,
    // кириллица в нём роняет сам fetch, а не приложение.
    const response = await get("/v1/me", "amplifie_session=totally-made-up-token-000");
    expect(response.status).toBe(401);
  });

  it("печенька закрыта от скриптов и не уезжает на чужие сайты", async () => {
    const email = freshEmail("cookie");
    const response = await post("/v1/auth/register", {
      email,
      password: "правильный-конский-скотч-батарейка",
      displayName: "Проверка",
      workspaceName: "Проверочное",
    });

    const header = (response.headers.getSetCookie?.() ?? []).find((c) =>
      c.startsWith("amplifie_session="),
    );
    expect(header).toMatch(/^amplifie_session=[A-Za-z0-9_-]{43};/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
  });

  it("короткий пароль отклоняется с разбором по полям", async () => {
    const response = await post("/v1/auth/register", {
      email: freshEmail("short"),
      password: "123",
      displayName: "Кто-то",
      workspaceName: "Что-то",
    });
    expect(response.status).toBe(422);

    const body = (await response.json()) as { error: string; fields?: Record<string, string> };
    expect(body.error).toBe("validation_failed");
    // Слова — из схемы двери (`registerBody` в @amplifie/contract): их видит человек.
    expect(body.fields?.password).toBe("пароль короче 12 символов");
  });
});
