/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПОРЯДКА В ПАНЕЛИ (Д-30, task-036).
 *
 * ⚠️ ЭТО СТОРОЖ НА СМЫСЛ, А НЕ НА СКОРОСТЬ. Задача, ради которой он
 * написан, — ускорение: свежесть канала перестаёт считаться обходом всей
 * его переписки. Скорость проверяется ЗАМЕРОМ в логе задачи, а не здесь:
 * тест на время краснеет от нагрузки соседнего процесса и превращается
 * в мигающий, а мигающий тест хуже отсутствующего.
 *
 * Здесь проверяется единственное, что ускорение может испортить, —
 * ПОРЯДОК каналов. Его человек видит сразу, и врёт он молча.
 *
 * ⚠️ ВТОРОЙ СЛУЧАЙ ВАЖНЕЕ ПЕРВОГО. «Свежесть» и «когда в последний раз
 * менялось» — разные вещи: правка старой реплики двигает номер изменения
 * (Р-021), но НЕ должна поднимать канал наверх, иначе исправленная
 * опечатка недельной давности вытолкнет сегодняшний разговор.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `panel-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Person {
  cookie: string;
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

async function newPerson(): Promise<Person> {
  const response = await post("/v1/auth/register", {
    email: freshEmail(),
    password: PASSWORD,
    displayName: "Смотрящий",
    workspaceName: "Пространство порядка",
  });
  if (response.status !== 201) throw new Error(`регистрация не удалась: ${response.status}`);
  return { cookie: sessionCookie(response) };
}

async function newChannel(person: Person, title: string): Promise<string> {
  const response = await post("/v1/conversations", { title }, person);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function say(person: Person, conversationId: string, body: string): Promise<string> {
  const response = await post(
    `/v1/conversations/${conversationId}/messages`,
    { body, clientMsgId: crypto.randomUUID() },
    person,
  );
  expect(response.status, `реплика «${body}» не отправилась`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Позвать второго человека в то же пространство. */
async function invite(owner: Person): Promise<Person> {
  const created = await post("/v1/invites", { maxUses: 50 }, owner);
  const { token } = (await created.json()) as { token: string };
  const entered = await post("/v1/auth/join", {
    token,
    email: freshEmail(),
    password: PASSWORD,
    displayName: "Коллега",
  });
  if (entered.status !== 201) throw new Error(`вход по ссылке: ${entered.status}`);
  return { cookie: sessionCookie(entered) };
}

/** Закрепить разговор в СВОЕЙ панели либо снять закрепление (task-038). */
async function pin(person: Person, conversationId: string, on: boolean): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${conversationId}/pin`, {
    method: on ? "POST" : "DELETE",
    headers: { cookie: person.cookie },
  });
}

/** Названия каналов в том порядке, в каком их показывает панель. */
async function order(person: Person): Promise<string[]> {
  const response = await get("/v1/conversations", person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: { title: string }[] };
  return body.items.map((one) => one.title);
}

describe("порядок каналов в панели", () => {
  beforeAll(async () => {
    const health = await get("/health");
    if (!health.ok) throw new Error(`Стек не поднят (${BASE}/health). Запусти: make up`);
  });

  it("канал, в котором сказали позже, стоит выше", async () => {
    const person = await newPerson();
    const first = await newChannel(person, "Первый");
    const second = await newChannel(person, "Второй");
    const third = await newChannel(person, "Третий");

    await say(person, second, "во втором");
    await say(person, third, "в третьем");
    await say(person, first, "в первом");

    const list = await order(person);
    expect(list.slice(0, 3), "панель сортирует не по свежести разговора").toEqual([
      "Первый",
      "Третий",
      "Второй",
    ]);
  });

  /**
   * ЗАКРЕПЛЕНИЕ (task-038, Д-32 закрыт владельцем: закрепление ЛИЧНОЕ).
   *
   * ⚠️ ПОРЯДОК СЧИТАЕТ СЕРВЕР, И ЗАКРЕПЛЁННОЕ ПОДНИМАЕТ ТОЖЕ ОН. Сделай
   * это клиент — про порядок знали бы двое, и однажды они разошлись бы:
   * у одного закреплённое сверху, у другого нет.
   */
  it("закреплённый канал стоит выше свежего", async () => {
    const person = await newPerson();
    const quiet = await newChannel(person, "Редкий");
    const fresh = await newChannel(person, "Свежий");

    await say(person, quiet, "давно");
    await say(person, fresh, "только что");
    expect((await order(person)).slice(0, 2)).toEqual(["Свежий", "Редкий"]);

    expect((await pin(person, quiet, true)).status).toBe(204);
    expect(
      (await order(person)).slice(0, 2),
      "закреплённый канал не поднялся — закреплять его тогда незачем",
    ).toEqual(["Редкий", "Свежий"]);

    expect((await pin(person, quiet, false)).status).toBe(204);
    expect((await order(person)).slice(0, 2), "снятое закрепление не отпустило").toEqual([
      "Свежий",
      "Редкий",
    ]);
  });

  it("закрепление личное: у коллеги порядок свой", async () => {
    const owner = await newPerson();
    const quiet = await newChannel(owner, "Редкий");
    const fresh = await newChannel(owner, "Свежий");
    await say(owner, quiet, "давно");
    await say(owner, fresh, "только что");

    const mate = await invite(owner);
    expect((await pin(owner, quiet, true)).status).toBe(204);

    expect((await order(owner)).slice(0, 2)).toEqual(["Редкий", "Свежий"]);
    expect(
      (await order(mate)).slice(0, 2),
      "моё закрепление переставило панель коллеге — это его взгляд, не мой",
    ).toEqual(["Свежий", "Редкий"]);
  });

  it("закрепить дважды — тот же исход, а не ошибка", async () => {
    const person = await newPerson();
    const channel = await newChannel(person, "Дважды");
    expect((await pin(person, channel, true)).status).toBe(204);
    expect(
      (await pin(person, channel, true)).status,
      "повтор закрепления отвечает ошибкой — а он ничего не меняет",
    ).toBe(204);
  });

  it("чужой разговор закрепить нельзя", async () => {
    const owner = await newPerson();
    const stranger = await newPerson();
    const channel = await newChannel(owner, "Не твой");

    expect(
      (await pin(stranger, channel, true)).status,
      "закрепили разговор, которого не видно: панель рассказала бы о нём",
    ).toBe(404);
  });

  it("правка старой реплики не поднимает канал наверх", async () => {
    const person = await newPerson();
    const old = await newChannel(person, "Старый");
    const fresh = await newChannel(person, "Свежий");

    const oldMessage = await say(person, old, "давняя реплика");
    await say(person, fresh, "сегодняшняя реплика");
    expect((await order(person)).slice(0, 2)).toEqual(["Свежий", "Старый"]);

    // Правка двигает номер ИЗМЕНЕНИЯ (Р-021) — по нему живёт догон.
    // Место в списке живёт по другому вопросу: когда тут говорили.
    const edit = await fetch(`${BASE}/v1/messages/${oldMessage}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ body: "давняя реплика, исправленная" }),
    });
    expect(edit.status).toBe(200);

    expect(
      (await order(person)).slice(0, 2),
      "исправленная опечатка недельной давности вытолкнула сегодняшний разговор",
    ).toEqual(["Свежий", "Старый"]);
  });
});
