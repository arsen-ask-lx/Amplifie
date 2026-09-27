/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПОИСКА ЧАТА ПО НАЗВАНИЮ (task-117, П-1–П-6). Написан ДО кода
 * и обязан быть красным.
 *
 * Окно «Переслать» раньше просило весь список пространства одним ответом
 * (Д-41: 1,4 МБ на засеянной базе). Теперь оно ищет — и дверь поиска обязана
 * отдавать ровно видимое человеку: приватный чат соседа в выдаче — это не
 * «лишняя строка», а чужое название, показанное постороннему.
 *
 * Каждый тест — своё пространство (`newPerson`): выдача считается точно.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

interface Row {
  id: string;
  title: string;
  parentId: string | null;
}

async function channel(owner: Person, title: string, visibility = "workspace"): Promise<string> {
  const response = await call("POST", "/v1/conversations", owner, { title, visibility });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function find(person: Person, q: string, limit?: number): Promise<Row[]> {
  const response = await call("POST", "/v1/search/chats", person, {
    q,
    ...(limit === undefined ? {} : { limit }),
  });
  expect(response.status, `поиск чата «${q}»`).toBe(200);
  return ((await response.json()) as { items: Row[] }).items;
}

const titles = (rows: Row[]) => rows.map((one) => one.title);

describe("поиск чата по названию", () => {
  beforeAll(requireStand);

  it("П-1: без регистра, ё как е, начало названия — первым", async () => {
    const owner = await newPerson("Хозяин");
    for (const title of ["Смета клиента", "СМЕТА-2", "Ёлка", "Договор"]) {
      await channel(owner, title);
    }

    expect(titles(await find(owner, "смет")).sort()).toEqual(["Смета клиента", "СМЕТА-2"].sort());
    expect(titles(await find(owner, "елка"))).toEqual(["Ёлка"]);
    expect(titles(await find(owner, "Ёл"))).toEqual(["Ёлка"]);
    expect(titles(await find(owner, "смета-2"))[0]).toBe("СМЕТА-2");
    expect(titles(await find(owner, "договор"))).toEqual(["Договор"]);
  });

  it("П-1: совпадение с начала названия стоит выше совпадения в середине", async () => {
    const owner = await newPerson("Хозяин");
    await channel(owner, "Старая смета");
    await channel(owner, "Смета новая");

    expect(titles(await find(owner, "смета"))).toEqual(["Смета новая", "Старая смета"]);
  });

  it("П-2: знаки % и _ ищутся как знаки, а не как шаблон", async () => {
    const owner = await newPerson("Хозяин");
    await channel(owner, "скидка 50%");
    await channel(owner, "скидка 500");
    await channel(owner, "план_на_год");

    expect(titles(await find(owner, "50%"))).toEqual(["скидка 50%"]);
    expect(titles(await find(owner, "_"))).toEqual(["план_на_год"]);
    expect(titles(await find(owner, "\\"))).toEqual([]);
  });

  it("П-3: приватный чат соседа и ветки не находятся", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Сосед");
    await channel(owner, "Секрет владельца", "private");
    const open = await channel(owner, "Секрет открытый");
    const branch = await call("POST", `/v1/conversations/${open}/threads`, owner, {
      title: "Секрет ветки",
    });
    expect(branch.status).toBe(201);

    expect(titles(await find(mate, "секрет"))).toEqual(["Секрет открытый"]);
    expect(titles(await find(owner, "секрет")).sort()).toEqual(
      ["Секрет владельца", "Секрет открытый"].sort(),
    );
    for (const row of await find(owner, "секрет")) expect(row.parentId).toBeNull();
  });

  it("П-4: предел выдачи и отказ на неверное тело", async () => {
    const owner = await newPerson("Хозяин");
    for (let n = 0; n < 7; n++) await channel(owner, `Отчёт ${n}`);

    expect(await find(owner, "отчёт", 5)).toHaveLength(5);
    expect(await find(owner, "отчёт")).toHaveLength(7);
    for (const body of [
      { q: "отчёт", limit: 51 },
      { q: "" },
      { q: "   " },
      { q: "x".repeat(101) },
    ]) {
      const response = await call("POST", "/v1/search/chats", owner, body);
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(422);
    }
  });

  it("П-5: старая дверь списка отдаёт не больше ста строк", async () => {
    const owner = await newPerson("Хозяин");
    // 104 канала плюс общий, который есть у пространства с рождения.
    // ⚠️ ПАЧКАМИ ПО ВОСЕМЬ, А НЕ ВСЕ РАЗОМ: сто запросов одновременно рядом
    // с соседними файлами набора рвали соединение (ECONNRESET, 27.09).
    for (let from = 0; from < 104; from += 8) {
      const batch = Array.from({ length: Math.min(8, 104 - from) }, (_, n) => from + n);
      await Promise.all(batch.map((n) => channel(owner, `Канал ${n}`)));
    }
    const list = async (query: string) => {
      const response = await call("GET", `/v1/conversations${query}`, owner);
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: Row[] }).items;
    };

    expect(await list("")).toHaveLength(100);
    expect(await list("?limit=5")).toHaveLength(5);
    expect(await list("?limit=мусор")).toHaveLength(100);
    expect(await list("?limit=100000")).toHaveLength(100);
    // Засев из ста с лишним каналов — не мгновенный: даём ему время.
  }, 60_000);

  it("П-6: перебор поиска упирается в порог человека", async () => {
    const owner = await newPerson("Хозяин");
    let status = 0;
    for (let attempt = 0; attempt < 130 && status !== 429; attempt++) {
      status = (await call("POST", "/v1/search/chats", owner, { q: `z${attempt}` })).status;
    }
    expect(status, "130 поисков за минуту прошли без порога").toBe(429);
  });
});
