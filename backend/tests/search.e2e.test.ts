/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПОИСКА ПО СООБЩЕНИЯМ (task-100, П-1–П-8). Написан ДО кода
 * и обязан быть красным.
 *
 * Поиск — первая дверь, которая читает переписку ВСЕХ разговоров человека
 * разом. Ошибка в правах здесь — не «не тот чат», а чужой закрытый разговор
 * в выдаче. Поэтому права проверяются на каждый вид закрытости отдельно,
 * а совпадение слов — по обещанию владельцу: формы, начало слова, ё и е,
 * но не кусок из середины.
 *
 * Каждый тест — своё пространство (`newPerson`): слова одного теста не видны
 * другому, и выдача считается точно, а не «хотя бы одна».
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { mentionMarkup } from "@amplifie/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

interface Found {
  id: string;
  seq: number;
  body: string;
  conversationId: string;
  conversationTitle: string;
  replyTo: { id: string } | null;
}

interface Page {
  items: Found[];
  next: number | null;
  /** Сколько всего попаданий — только для поиска в одном чате (task-106). */
  total?: number;
}

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

async function channel(owner: Person, title: string, visibility = "workspace"): Promise<string> {
  const response = await call("POST", "/v1/conversations", owner, { title, visibility });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function thread(owner: Person, parent: string, title: string): Promise<string> {
  const response = await call("POST", `/v1/conversations/${parent}/threads`, owner, { title });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function say(
  person: Person,
  where: string,
  body: string,
  replyToId?: string,
): Promise<{ id: string; seq: number }> {
  const response = await call("POST", `/v1/conversations/${where}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
    ...(replyToId ? { replyToId } : {}),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; seq: number };
}

async function search(person: Person, q: string, extra: object = {}): Promise<Page> {
  const response = await call("POST", "/v1/search/messages", person, { q, ...extra });
  expect(response.status, `поиск «${q}»`).toBe(200);
  return (await response.json()) as Page;
}

const bodies = (page: Page) => page.items.map((one) => one.body);

describe("поиск по сообщениям", () => {
  beforeAll(requireStand);

  it("П-1: формы слова, начало слова, ё и е, английский — да; середина слова — нет", async () => {
    const owner = await newPerson("Хозяин");
    const room = await firstChannel(owner);
    await say(owner, room, "подписали договоры с поставщиком");
    await say(owner, room, "Договора пришли почтой");
    await say(owner, room, "на ёлке игрушки");
    await say(owner, room, "the build was deployed");
    await say(owner, room, "это не пришёл курьер");

    expect(bodies(await search(owner, "договор")).sort()).toEqual([
      "Договора пришли почтой",
      "подписали договоры с поставщиком",
    ]);
    expect(bodies(await search(owner, "догов"))).toHaveLength(2);
    expect(bodies(await search(owner, "елке"))).toEqual(["на ёлке игрушки"]);
    expect(bodies(await search(owner, "ёлке"))).toEqual(["на ёлке игрушки"]);
    expect(bodies(await search(owner, "deploy"))).toEqual(["the build was deployed"]);
    expect(bodies(await search(owner, "не пришёл"))).toEqual(["это не пришёл курьер"]);
    // Решение владельца 17.09: кусок из середины слова не ищется.
    expect(bodies(await search(owner, "говор"))).toEqual([]);
  });

  it("П-2: невидимое не находится никогда, своё закрытое — находится", async () => {
    const owner = await newPerson("Хозяин");
    const stranger = await colleague(owner, "Посторонний");
    // Первый канал — до заведения остальных: список идёт по свежести.
    const open = await firstChannel(owner);
    const secret = await channel(owner, "Закрытый", "private");
    const secretThread = await thread(owner, secret, "Ветка закрытого");
    const gone = await channel(owner, "Снесённый");

    await say(owner, secret, "лиственница в закрытом");
    await say(owner, secretThread, "лиственница в ветке закрытого");
    await say(owner, gone, "лиственница в снесённом");
    const removed = await say(owner, open, "лиственница удалённая");
    await say(owner, open, "лиственница открытая");
    expect((await call("DELETE", `/v1/conversations/${gone}`, owner)).status).toBe(204);
    expect((await call("DELETE", `/v1/messages/${removed.id}`, owner)).status).toBe(204);

    const elsewhere = await newPerson("Чужой");
    await say(elsewhere, await firstChannel(elsewhere), "лиственница в чужом пространстве");

    expect(bodies(await search(stranger, "лиственница")), "посторонний видит лишнее").toEqual([
      "лиственница открытая",
    ]);
    expect(bodies(await search(owner, "лиственница")).sort(), "хозяин не видит своё").toEqual([
      "лиственница в ветке закрытого",
      "лиственница в закрытом",
      "лиственница открытая",
    ]);
  });

  it("П-3: после правки находится новое слово и не находится старое", async () => {
    const owner = await newPerson("Хозяин");
    const room = await firstChannel(owner);
    const said = await say(owner, room, "встреча во вторник");
    const edited = await call("PATCH", `/v1/messages/${said.id}`, owner, {
      body: "встреча в четверг",
    });
    expect(edited.status).toBe(200);

    expect(bodies(await search(owner, "четверг"))).toEqual(["встреча в четверг"]);
    expect(bodies(await search(owner, "вторник"))).toEqual([]);
  });

  it("П-4: номер человека в упоминании не ищется, подпись — ищется", async () => {
    const owner = await newPerson("Хозяин");
    const anna = await colleague(owner, "Анна");
    const room = await firstChannel(owner);
    const body = `позови ${mentionMarkup("Анна", anna.participantId)} на созвон`;
    await say(owner, room, body);

    const piece = anna.participantId.split("-")[1] ?? "";
    expect(bodies(await search(owner, piece)), "кусок номера нашёл упоминание").toEqual([]);
    expect(bodies(await search(owner, "Анна"))).toEqual([body]);
  });

  it("П-6: новые сверху, страницы по курсору без повторов и пропусков", async () => {
    const owner = await newPerson("Хозяин");
    const room = await firstChannel(owner);
    // 25 + 1: порог отправки — 30 реплик в минуту на человека (Р-025).
    for (let n = 1; n <= 25; n++) await say(owner, room, `смета номер ${n}`);

    const first = await search(owner, "смета", { limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.next).not.toBeNull();
    const seqs = first.items.map((one) => one.seq);
    expect(seqs, "не по убыванию").toEqual([...seqs].sort((a, b) => b - a));

    await say(owner, room, "смета номер 26 — между страницами");
    const second = await search(owner, "смета", { limit: 20, before: first.next });
    expect(second.items).toHaveLength(5);
    expect(second.next).toBeNull();

    const all = [...first.items, ...second.items].map((one) => one.body);
    expect(new Set(all).size).toBe(25);
    expect(all).not.toContain("смета номер 26 — между страницами");
  });

  it("П-7: слишком длинный запрос — отказ; одни однобуквенные слова — пусто без поиска", async () => {
    const owner = await newPerson("Хозяин");
    const long = await call("POST", "/v1/search/messages", owner, { q: "я".repeat(201) });
    expect(long.status).toBe(422);

    const empty = await call("POST", "/v1/search/messages", owner, { q: "а б в" });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as Page).items).toEqual([]);
    // Только проверка сессии: к таблице поиска запрос не ходил.
    expect(Number(empty.headers.get("x-db-queries"))).toBeLessThanOrEqual(1);
  });

  it("task-106 П-1: поиск в одном чате отдаёт только его реплики и число всего", async () => {
    const owner = await newPerson("Хозяин");
    const here = await firstChannel(owner);
    const there = await channel(owner, "Соседний");
    await say(owner, here, "смета на кровлю");
    await say(owner, here, "смета на фундамент");
    await say(owner, there, "смета соседнего чата");

    const inRoom = await search(owner, "смета", { conversationId: here });
    expect(bodies(inRoom).sort()).toEqual(["смета на кровлю", "смета на фундамент"]);
    // ⚠️ ЧИСЛО ВСЕГО НУЖНО СЧЁТЧИКУ «3 из 17»: без него полоса поиска
    // не может сказать, сколько попаданий, не выкачав их все.
    expect(inRoom.total, "число всего не пришло").toBe(2);

    // Общий поиск не изменился: и число всего он не считает — его никто
    // не показывает, а лишний запрос стоит буферов.
    const everywhere = await search(owner, "смета");
    expect(bodies(everywhere)).toHaveLength(3);
    expect(everywhere.total).toBeUndefined();
  });

  it("task-106 П-1: чужой чат по номеру не открывается поиском", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Сосед");
    const closed = await channel(owner, "Закрытый", "private");
    await say(owner, closed, "смета закрытого чата");

    // Номер чата известен, доступа нет: выдача пуста, а не «не ваш чат».
    const page = await search(guest, "смета", { conversationId: closed });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("П-8: найденное — это вид сообщения ленты плюс название чата", async () => {
    const owner = await newPerson("Хозяин");
    const room = await firstChannel(owner);
    const asked = await say(owner, room, "кто везёт арматуру");
    await say(owner, room, "арматуру везёт склад", asked.id);

    const page = await search(owner, "склад");
    const found = page.items[0];
    expect(found?.conversationId).toBe(room);
    expect(found?.conversationTitle).toBeTruthy();
    expect(found?.replyTo?.id).toBe(asked.id);
  });
});
