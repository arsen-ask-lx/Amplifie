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
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

const LIMIT = 100;

async function firstChannel(person: Person): Promise<string> {
  const list = await call("GET", "/v1/conversations", person);
  const id = ((await list.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
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

async function pinnedIds(person: Person, room: string): Promise<string[]> {
  const response = await call("GET", `/v1/conversations/${room}/pinned`, person);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Array<{ id: string }> }).items.map((one) => one.id);
}

async function pinnedCount(person: Person, room: string): Promise<number> {
  return (await pinnedIds(person, room)).length;
}

describe("закреплённое: потолок и частота", () => {
  beforeAll(requireStand);

  let people: Person[] = [];
  let room = "";
  /** По 21 реплике на каждого: 20 закрепляет сам, одна — в запас. */
  const said: string[][] = [];

  beforeAll(async () => {
    const owner = await newPerson("Хозяин");
    people = [owner];
    for (const name of ["Анна", "Борис", "Вера", "Глеб"]) people.push(await colleague(owner, name));
    room = await firstChannel(owner);
    for (const [n, person] of people.entries()) {
      const mine: string[] = [];
      for (let k = 0; k < 21; k++) mine.push(await say(person, room, `реплика ${n}-${k}`));
      said.push(mine);
    }
  }, 120_000);

  /**
   * Своё исходное состояние, а не наследство прошлого теста: закреплены
   * первые двадцать реплик каждого, кроме said[2][0], — ровно 99. После
   * первого теста это одно открепление, при запуске в одиночку — 99
   * закреплений (порог — 30 в минуту на человека, у каждого по двадцать).
   */
  async function holdAt99(): Promise<void> {
    const owner = people[0] as Person;
    const have = new Set(await pinnedIds(owner, room));
    // Запасную said[0][20] и said[2][0] снимаем, если закреплены: вторая
    // остаётся, когда первый тест упал до открепления, — иначе 100, а не 99.
    const releases: Array<[Person, string]> = [
      [owner, said[0]?.[20] ?? ""],
      [people[2] as Person, said[2]?.[0] ?? ""],
    ];
    for (const [who, id] of releases.filter(([, one]) => have.has(one))) {
      expect((await unpin(who, id)).status).toBe(204);
    }
    for (const [n, person] of people.entries()) {
      const wanted = (said[n]?.slice(0, 20) ?? []).filter(
        (id) => id !== said[2]?.[0] && !have.has(id),
      );
      for (const id of wanted) {
        expect((await pin(person, id)).status, "подготовка 99 закреплений").toBe(204);
      }
    }
  }

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
    expect(await pinnedCount(people[0] as Person, room), "повтор занял место").toBe(LIMIT);

    // Открепил одно — место освободилось.
    expect((await unpin(people[2] as Person, said[2]?.[0] ?? "")).status).toBe(204);
    expect((await pin(people[0] as Person, extra)).status, "место не освободилось").toBe(204);
    expect(await pinnedCount(people[0] as Person, room)).toBe(LIMIT);
  }, 120_000);

  it("четверо закрепляют одновременно у 99 — проходит ровно один", async () => {
    // ⚠️ НАЙДЕНО РЕВЬЮ open-code-review 26.09 (Р-046): подсчёт шёл ДО замка
    // пространства, и двое одновременных у 99 оба видели 99 — выходило 101.
    const owner = people[0] as Person;
    await holdAt99();
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
    // Свой человек в своём пространстве: ни счётчик, ни потолок сотни
    // не достаются от сценариев выше.
    // Одну и ту же реплику — раз за разом: повтор места не занимает, но
    // запросом считается. У каждой двери свой счётчик, поэтому бьём в одну.
    const hand = await newPerson("Дина");
    const id = await say(hand, await firstChannel(hand), "реплика для порога");
    let blocked = 0;
    for (let n = 0; n < 40 && blocked === 0; n++) {
      if ((await pin(hand, id)).status === 429) blocked = n + 1;
    }
    // Тридцать в минуту, как у отправки: тридцать первый — отказ.
    expect(blocked, "порог закрепа не тот").toBe(31);
  }, 60_000);
});
