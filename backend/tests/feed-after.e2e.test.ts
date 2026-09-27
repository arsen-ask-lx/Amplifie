/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЛЕНТЫ ВПЕРЁД (task-099, П-1). Написан ДО правки и обязан
 * быть красным.
 *
 * Переход к сообщению годичной давности открывает ленту ВОКРУГ него,
 * и дальше человек листает не только назад, но и вперёд — к живому концу.
 * Страница «вперёд» обязана отдавать ровно то, что новее номера, по порядку
 * и без чужого закрытого: пропусти она строку — в ленте дыра, которую
 * никто не заметит глазами.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

interface Page {
  items: { id: string; seq: number }[];
  hasMore: boolean;
  head: number;
}

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

async function say(person: Person, channel: string, body: string): Promise<number> {
  const response = await call("POST", `/v1/conversations/${channel}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { seq: number }).seq;
}

async function page(person: Person, channel: string, query: string): Promise<Response> {
  return call("GET", `/v1/conversations/${channel}/messages?${query}`, person);
}

describe("лента вперёд от номера", () => {
  beforeAll(requireStand);

  it("отдаёт строго новее номера, по возрастанию, и говорит, есть ли ещё", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const seqs: number[] = [];
    for (const body of ["раз", "два", "три", "четыре", "пять"]) {
      seqs.push(await say(owner, channel, body));
    }

    const middle = await page(owner, channel, `after=${seqs[1]}&limit=2`);
    expect(middle.status).toBe(200);
    const first = (await middle.json()) as Page;
    expect(first.items.map((one) => one.seq)).toEqual([seqs[2], seqs[3]]);
    expect(first.hasMore, "за четвёртой есть пятая").toBe(true);

    const end = (await (await page(owner, channel, `after=${seqs[4]}&limit=2`)).json()) as Page;
    expect(end.items).toEqual([]);
    expect(end.hasMore, "после последней ничего нет").toBe(false);
  });

  it("неполная страница вперёд — это конец ленты", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const a = await say(owner, channel, "раз");
    const b = await say(owner, channel, "два");

    const tail = (await (await page(owner, channel, `after=${a}&limit=5`)).json()) as Page;
    expect(tail.items.map((one) => one.seq)).toEqual([b]);
    expect(tail.hasMore).toBe(false);
  });

  it("два курсора разом — отказ, а не молчаливый выбор одного", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const response = await page(owner, channel, "before=10&after=2");
    // Неверный ввод у всех дверей — 422 `validation_failed` (`failures.ts`).
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe("validation_failed");
  });

  it("чужой закрытый канал не читается и вперёд", async () => {
    const owner = await newPerson("Хозяин");
    const stranger = await colleague(owner, "Посторонний");
    const created = await call("POST", "/v1/conversations", owner, {
      title: "Закрытый",
      visibility: "private",
    });
    expect(created.status).toBe(201);
    const secret = ((await created.json()) as { id: string }).id;
    const seq = await say(owner, secret, "тайна");

    // Положительный контроль: хозяину та же страница отдаёт реплику —
    // 404 ниже про постороннего, а не про неверный запрос.
    const own = (await (await page(owner, secret, `after=${seq - 1}`)).json()) as Page;
    expect(own.items.map((one) => one.seq)).toEqual([seq]);

    const response = await page(stranger, secret, `after=${seq - 1}`);
    expect(response.status).toBe(404);
  });
});
