/**
 * ПРИЁМОЧНЫЙ ТЕСТ: второй человек входит в компанию (task-017, Р-009).
 * Написан ДО кода и обязан быть красным.
 *
 * ⚠️ ПРОВЕРЯЕТСЯ НЕ ФУНКЦИЯ, А СПОСОБЫ ВОЙТИ НЕЗАКОННО. Каждый тест ниже
 * стережёт отдельный способ, и все они взяты из разбора чужой уязвимости
 * в Р-009: тот же токен, поданный через ДРУГОЙ поток входа, обходил
 * проверку доступа. Ошибка была не в токене — в том, что путей входа
 * оказалось два, и второй забыли проверить.
 *
 * Бьёт по живому стеку через настоящий порт. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, freshEmail, newPerson, type Person, requireStand, sessionCookie } from "./stand.js";

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function del(path: string, cookie: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: "DELETE", headers: { cookie } });
}

async function get(path: string, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
}

/** Владелец со своей компанией: тот, кто зовёт. */
type Owner = Person;

async function newOwner(name: string): Promise<Owner> {
  return newPerson(name);
}

/** Позвать: ссылка с пределом входов и сроком. */
async function invite(owner: Owner, maxUses = 50): Promise<string> {
  const response = await post("/v1/invites", { maxUses }, owner.cookie);
  expect(response.status, "создание приглашения").toBe(201);
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** Войти по ссылке. Возвращает ответ как есть — его и проверяем. */
async function join(token: string, tag = "guest"): Promise<Response> {
  return post("/v1/auth/join", {
    token,
    email: freshEmail(tag),
    password: "очень-длинный-пароль-для-теста",
    displayName: "Гость",
  });
}

describe("вход второго человека в компанию", () => {
  beforeAll(requireStand);

  it("П-2: вошедший по ссылке оказывается в ТОЙ ЖЕ компании и видит общий канал", async () => {
    const owner = await newOwner("Зовущий");
    const token = await invite(owner);

    const entered = await join(token);
    expect(entered.status).toBe(201);

    const me = (await entered.json()) as { workspace: { id: string } };
    expect(me.workspace.id, "гость попал в чужую компанию, а не в ту же").toBe(owner.workspaceId);

    const cookie = sessionCookie(entered);
    const rooms = await get("/v1/conversations", cookie);
    expect(rooms.status).toBe(200);
    const list = (await rooms.json()) as { items: Array<{ title: string }> };
    expect(list.items.map((one) => one.title)).toContain("Общий");
  });

  it("П-3: разовая ссылка вторым входом не работает", async () => {
    const owner = await newOwner("Разовый");
    const token = await invite(owner, 1);

    expect((await join(token, "first")).status).toBe(201);
    expect((await join(token, "second")).status, "разовая ссылка сработала дважды").toBe(404);
  });

  it("П-4: отозванная, исчерпанная и несуществующая ссылки отвечают ОДИНАКОВО", async () => {
    const owner = await newOwner("Отзыв");

    // Отозванная.
    const created = await post("/v1/invites", { maxUses: 50 }, owner.cookie);
    const { id, token } = (await created.json()) as { id: string; token: string };
    expect((await del(`/v1/invites/${id}`, owner.cookie)).status).toBe(204);
    const revoked = await join(token, "revoked");

    // Исчерпанная.
    const spent = await invite(owner, 1);
    await join(spent, "spender");
    const exhausted = await join(spent, "late");

    // Несуществующая.
    const nobody = await join("ZZZ-этого-токена-нет-и-не-было-ZZZ", "ghost");

    const responses = [revoked, exhausted, nobody];
    expect(
      responses.map((r) => r.status),
      "по разнице ответов переберут живые ссылки",
    ).toEqual([404, 404, 404]);

    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(new Set(bodies).size, "тела ответов различаются — это тоже подсказка").toBe(1);
  });

  it("П-5: два устройства с последним входом — входит ровно один", async () => {
    const owner = await newOwner("Гонка");
    const token = await invite(owner, 1);

    // ⚠️ ОДНОВРЕМЕННО, А НЕ ПО ОЧЕРЕДИ. Одноразовость обязана держаться
    // условием в самом изменении, а не проверкой «а не занято ли»
    // отдельным запросом: та была бы гонкой — той же, что мы уже ловили
    // в отправке сообщений.
    const [one, two] = await Promise.all([join(token, "dev-a"), join(token, "dev-b")]);
    const successes = [one.status, two.status].filter((s) => s === 201);
    expect(successes.length, "по одной ссылке вошли двое").toBe(1);
  });

  it("П-6: вошедший не видит закрытый канал, в котором не состоит", async () => {
    const owner = await newOwner("Закрытый");
    const secret = await post(
      "/v1/conversations",
      { title: "Только для своих", visibility: "private" },
      owner.cookie,
    );
    expect(secret.status).toBe(201);

    const entered = await join(await invite(owner), "outsider");
    expect(entered.status).toBe(201);
    const cookie = sessionCookie(entered);

    const titlesOf = async (session: string) => {
      const rooms = await get("/v1/conversations", session);
      expect(rooms.status).toBe(200);
      const list = (await rooms.json()) as { items: Array<{ title: string }> };
      return list.items.map((one) => one.title);
    };

    // Положительный контроль: хозяин закрытый канал видит, а вошедший
    // видит общий — отказ ниже про закрытость, а не про пустой список.
    expect(await titlesOf(owner.cookie)).toContain("Только для своих");
    const seen = await titlesOf(cookie);
    expect(seen).toContain("Общий");
    expect(seen, "закрытый канал просвечивает").not.toContain("Только для своих");
  });

  it("П-8: регистрация НЕ принимает приглашение — второго пути внутрь нет", async () => {
    const owner = await newOwner("Единственная дверь");
    const token = await invite(owner);

    // ⚠️ ЭТО И ЕСТЬ ТОТ САМЫЙ КЛАСС УЯЗВИМОСТИ (Р-009): токен, поданный
    // через ДРУГОЙ поток входа. Регистрация обязана его не заметить
    // вовсе — не «отказать», а сделать своё дело и завести НОВУЮ компанию.
    const response = await post("/v1/auth/register", {
      token,
      email: freshEmail("sneaky"),
      password: "очень-длинный-пароль-для-теста",
      displayName: "Пролезающий",
      workspaceName: "Своя компания",
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as { workspace: { id: string; name: string } };
    expect(body.workspace.id, "регистрация впустила по токену в ЧУЖУЮ компанию").not.toBe(
      owner.workspaceId,
    );
    // И компания — та, что заводили, а не чья-то ещё.
    expect(body.workspace.name).toBe("Своя компания");
  });

  it("владелец другой компании не может отозвать чужое приглашение", async () => {
    const first = await newOwner("Первый");
    const second = await newOwner("Второй");

    const created = await post("/v1/invites", { maxUses: 50 }, first.cookie);
    expect(created.status).toBe(201);
    const { id, token } = (await created.json()) as { id: string; token: string };

    // Чужое приглашение не отзывается и не существует для постороннего —
    // ответ тот же 404, что и у несуществующего.
    expect((await del(`/v1/invites/${id}`, second.cookie)).status).toBe(404);

    // Приглашение живо: по нему входят — и именно в компанию первого.
    const entered = await join(token, "after-foreign-revoke");
    expect(entered.status, "чужой отзыв погасил приглашение").toBe(201);
    const me = (await entered.json()) as { workspace: { id: string } };
    expect(me.workspace.id).toBe(first.workspaceId);
  });
});
