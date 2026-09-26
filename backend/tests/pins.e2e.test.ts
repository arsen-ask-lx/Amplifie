/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЗАКРЕПЛЁННОГО: потолок и частота (Р-045).
 *
 * Вопросы до кода (владелец 26.09, «что будет, если спамить закреплённым»):
 * 1. Сто первое закрепление в одном чате сервер не принимает и называет
 *    причину — закреплённое не растёт без края, и чат не открывается всё
 *    медленнее.
 * 2. Повторно закрепить уже закреплённое — не ошибка и места не занимает.
 * 3. Открепил одно — место освободилось.
 * 4. Закреплять чаще, чем может рука, нельзя: порог частоты, как у отправки.
 *
 * ⚠️ ПЯТЬ ЧЕЛОВЕК, А НЕ ОДИН. Порог частоты — на человека: один не дошёл бы
 * до сотни ни отправкой (30 в минуту), ни закреплением. Сотню закрепляет
 * команда — так, как это и бывает.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";
const LIMIT = 100;

interface Person {
  cookie: string;
}

function freshEmail(): string {
  return `pins-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

async function call(method: string, path: string, person: Person, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: person.cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function register(): Promise<Person> {
  const response = await fetch(`${BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: freshEmail(),
      password: PASSWORD,
      displayName: "Хозяин",
      workspaceName: "Закрепы",
    }),
  });
  if (response.status !== 201) throw new Error(`регистрация: ${response.status}`);
  return { cookie: sessionCookie(response) };
}

async function invite(owner: Person, name: string): Promise<Person> {
  const made = await call("POST", "/v1/invites", owner, { maxUses: 10 });
  const { token } = (await made.json()) as { token: string };
  const entered = await fetch(`${BASE}/v1/auth/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, email: freshEmail(), password: PASSWORD, displayName: name }),
  });
  if (entered.status !== 201) throw new Error(`вход по ссылке: ${entered.status}`);
  return { cookie: sessionCookie(entered) };
}

async function say(person: Person, room: string, body: string): Promise<string> {
  const response = await call("POST", `/v1/conversations/${room}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status, `реплика «${body}» не ушла`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const pin = (person: Person, id: string) => call("POST", `/v1/messages/${id}/pin`, person);
const unpin = (person: Person, id: string) => call("DELETE", `/v1/messages/${id}/pin`, person);

async function pinnedCount(person: Person, room: string): Promise<number> {
  const response = await call("GET", `/v1/conversations/${room}/pinned`, person);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: unknown[] }).items.length;
}

describe("закреплённое: потолок и частота", () => {
  let people: Person[] = [];
  let room = "";
  /** По 21 реплике на каждого: 20 закрепляет сам, одна — в запас. */
  const said: string[][] = [];

  beforeAll(async () => {
    const owner = await register();
    people = [owner];
    for (const name of ["Анна", "Борис", "Вера", "Глеб"]) people.push(await invite(owner, name));
    const list = await call("GET", "/v1/conversations", owner);
    room = ((await list.json()) as { items: Array<{ id: string }> }).items[0]?.id ?? "";
    for (const [n, person] of people.entries()) {
      const mine: string[] = [];
      for (let k = 0; k < 21; k++) mine.push(await say(person, room, `реплика ${n}-${k}`));
      said.push(mine);
    }
  }, 120_000);

  it("сто первое закрепление не проходит и называет причину; повтор и открепление — как прежде", async () => {
    for (const [n, person] of people.entries()) {
      for (const id of said[n]?.slice(0, 20) ?? []) {
        expect((await pin(person, id)).status, "закреп в пределах сотни не прошёл").toBe(204);
      }
    }
    expect(await pinnedCount(people[0] as Person, room)).toBe(LIMIT);

    // Сто первое — отказ с причиной, а не молчаливое «ок».
    const extra = said[0]?.[20] ?? "";
    const refused = await pin(people[0] as Person, extra);
    expect(refused.status, "сто первое закрепление прошло").toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("pin_limit");
    expect(await pinnedCount(people[0] as Person, room)).toBe(LIMIT);

    // Повтор уже закреплённого места не занимает и ошибкой не считается.
    expect((await pin(people[1] as Person, said[1]?.[0] ?? "")).status).toBe(204);

    // Открепил одно — место освободилось.
    expect((await unpin(people[2] as Person, said[2]?.[0] ?? "")).status).toBe(204);
    expect((await pin(people[0] as Person, extra)).status, "место не освободилось").toBe(204);
    expect(await pinnedCount(people[0] as Person, room)).toBe(LIMIT);
  }, 120_000);

  it("четверо закрепляют одновременно у 99 — проходит ровно один", async () => {
    // ⚠️ НАЙДЕНО РЕВЬЮ open-code-review 26.09 (Р-046): подсчёт шёл ДО замка
    // пространства, и двое одновременных у 99 оба видели 99 — выходило 101.
    const owner = people[0] as Person;
    expect((await unpin(owner, said[0]?.[20] ?? "")).status).toBe(204);
    expect(await pinnedCount(owner, room)).toBe(LIMIT - 1);

    const racers = [1, 2, 3, 4].map((n) => {
      const id = n === 2 ? said[2]?.[0] : said[n]?.[20];
      return pin(people[n] as Person, id ?? "");
    });
    const codes = (await Promise.all(racers)).map((one) => one.status).sort();
    expect(codes, "у сотни прошло не ровно одно закрепление").toEqual([204, 409, 409, 409]);
    expect(await pinnedCount(owner, room)).toBe(LIMIT);
  }, 60_000);

  it("закреплять чаще, чем может рука, нельзя", async () => {
    // Свежий человек: у пятерых выше счётчик уже потрачен первым сценарием.
    // Одну и ту же реплику — раз за разом: повтор места не занимает, но
    // запросом считается. У каждой двери свой счётчик, поэтому бьём в одну.
    const hand = await invite(people[0] as Person, "Дина");
    const id = await say(hand, room, "реплика для порога");
    let blocked = 0;
    for (let n = 0; n < 40 && blocked === 0; n++) {
      if ((await pin(hand, id)).status === 429) blocked = n + 1;
    }
    // Тридцать в минуту, как у отправки: тридцать первый — отказ.
    expect(blocked, "порог закрепа не тот").toBe(31);
  }, 60_000);
});
