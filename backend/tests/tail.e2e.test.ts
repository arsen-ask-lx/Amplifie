/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЗВОНКА С АДРЕСОМ И ХВОСТА ИЗМЕНЕНИЙ (task-067, Д-3).
 * Написан ДО кода и обязан быть красным.
 *
 * Свойство, ради которого всё делается: **одно сообщение не должно поднимать
 * всех**. Сегодня звонок пустой, поэтому каждая вкладка идёт в `/v1/sync`,
 * а тот идёт в базу: замерено 154 транзакции на одну реплику при ста
 * вкладках (`make db-per-event`). Лечится тем, что звонок называет адрес
 * изменения, и вкладка чужого разговора не идёт никуда.
 *
 * ⚠️ АДРЕС — ЭТО НЕ СОДЕРЖИМОЕ, И ЭТО РАЗВИЛКА, СНЯТАЯ ВЛАДЕЛЬЦЕМ 14.09.
 * Р-006 требует, чтобы поток нёс только факт изменения. Здесь он несёт
 * идентификатор разговора — без текста, автора и времени. Взамен появляется
 * обязанность, которой у пустого звонка не было: **адрес не смеет уехать
 * тому, кто этого разговора не видит.** Иначе звонок становится боковым
 * каналом к закрытой переписке, и это проверяется здесь же.
 *
 * Бьёт по живому стеку через настоящий порт. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, listenCalls, newPerson, type Person, requireStand } from "./stand.js";

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/panel", person);
  expect(response.status, "сводный ответ панели").toBe(200);
  const panel = (await response.json()) as { recent: { items: { id: string }[] } };
  const id = panel.recent.items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

async function newPrivateChannel(owner: Person, title: string): Promise<string> {
  const response = await call("POST", "/v1/conversations", owner, { title, visibility: "private" });
  expect(response.status, "закрытый канал заведён").toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function send(person: Person, conversation: string, body: string): Promise<void> {
  const response = await call("POST", `/v1/conversations/${conversation}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status, "реплика отправлена").toBe(201);
}

interface Caught {
  messages: { body?: string }[];
  seq: number;
  hasMore: boolean;
}

async function caughtUp(person: Person, after: number): Promise<Caught> {
  const response = await call("GET", `/v1/sync?after=${after}`, person);
  expect(response.status, "догон").toBe(200);
  return (await response.json()) as Caught;
}

/**
 * Сколько запросов к базе стоил догон.
 *
 * Стенд отдаёт это заголовком `x-db-queries` — он для этого и заведён.
 * Без него «быстрая дорога» осталась бы словом: ответ-то одинаковый,
 * а откуда он пришёл, снаружи не видно.
 */
async function queriesOfCatchUp(person: Person, after: number): Promise<number> {
  const response = await call("GET", `/v1/sync?after=${after}`, person);
  expect(response.status, "догон").toBe(200);
  const header = response.headers.get("x-db-queries");
  if (header === null) throw new Error("стенд не отдал x-db-queries — это не стенд");
  await response.json();
  return Number(header);
}

describe("звонок называет адрес изменения", () => {
  beforeAll(requireStand);

  it("звонок о сообщении несёт идентификатор того разговора, где оно появилось", async () => {
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);
    const stream = await listenCalls(owner);

    await send(owner, channel, "привет");

    const first = await stream.next();
    stream.stop();
    expect(first, "звонок о своей же реплике").not.toBeNull();
    expect(first?.conversation, "адрес в звонке").toBe(channel);
  });

  it("вкладка чужого разговора звонка не получает вовсе", async () => {
    // Ровно та экономия, ради которой делается работа: при 3000 вкладках
    // сообщение в одном чате не должно поднимать остальные 2999.
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Сосед");
    const common = await firstChannel(owner);
    const aside = await newPrivateChannel(owner, "Только хозяин");

    const watcher = await listenCalls(mate);
    await send(owner, aside, "это не для соседа");
    const call = await watcher.next(2500);
    watcher.stop();

    expect(call, "звонок о невидимом разговоре у постороннего").toBeNull();
    expect(common, "общий канал в замере не участвовал, но должен существовать").toBeTruthy();
  });

  it("адрес закрытого разговора не утекает даже как идентификатор", async () => {
    // Пустой звонок не мог ничего выдать. Звонок с адресом может — и это
    // новая обязанность, а не мелочь: посторонний не должен узнать даже,
    // что такой разговор существует.
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Сосед");
    const common = await firstChannel(owner);
    const secret = await newPrivateChannel(owner, "Зарплаты");

    const watcher = await listenCalls(mate);
    await send(owner, secret, "оклады на квартал");
    // В общий канал пишем ПОСЛЕ закрытого: звонок о нём обязан приехать,
    // и он же доказывает, что поток у соседа был живой, а не молчал.
    await send(owner, common, "всем привет");

    const seen: (string | null)[] = [];
    for (let n = 0; n < 2; n++) {
      const one = await watcher.next(2500);
      if (!one) break;
      seen.push(one.conversation);
    }
    watcher.stop();

    expect(seen, "звонок об общем канале").toContain(common);
    expect(seen, "адрес закрытого канала у постороннего").not.toContain(secret);
  });
});

describe("догон не меняет обещаний", () => {
  beforeAll(requireStand);

  it("после сообщения догон отдаёт его и двигает курсор", async () => {
    // Сторож против самой опасной ошибки этой работы: быстрый путь
    // не смеет отдавать меньше, чем отдавала база.
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);

    const before = await caughtUp(owner, 0);
    await send(owner, channel, "реплика для догона");
    const after = await caughtUp(owner, before.seq);

    expect(after.seq, "курсор сдвинулся").toBeGreaterThan(before.seq);
    expect(
      after.messages.some((one) => one.body === "реплика для догона"),
      "реплика в догоне",
    ).toBe(true);
  });

  it("догон постороннего не содержит реплик закрытого разговора", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Сосед");
    const secret = await newPrivateChannel(owner, "Зарплаты");

    const before = await caughtUp(mate, 0);
    await send(owner, secret, "оклады на квартал");
    const after = await caughtUp(mate, before.seq);

    expect(
      after.messages.some((one) => one.body === "оклады на квартал"),
      "чужая закрытая реплика в догоне",
    ).toBe(false);
  });
});

describe("быстрая дорога и база отдают одно и то же", () => {
  beforeAll(requireStand);

  it("один и тот же курсор даёт один и тот же ответ из памяти и из базы", async () => {
    /**
     * ⚠️ САМАЯ ОПАСНАЯ ОШИБКА ЭТОЙ РАБОТЫ — ДВЕ ДОРОГИ, РАЗОШЕДШИЕСЯ МОЛЧА.
     * Поэтому сверяются ответы ЦЕЛИКОМ, а не отдельные поля.
     *
     * Как заставить сервер ответить из базы, не трогая его изнутри: хвост
     * сбрасывается на любое изменение, которое он не умеет описать точно, —
     * например на заводку папки. Папка не двигает номер изменения, значит
     * курсор и ожидаемый ответ те же, а дорога — уже другая.
     */
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);

    const before = await caughtUp(owner, 0);
    await send(owner, channel, "одна реплика на две дороги");

    const fromMemory = await caughtUp(owner, before.seq);

    const folder = await call("POST", "/v1/projects", owner, { title: "Сброс хвоста" });
    expect(folder.status, "папка заведена").toBe(201);

    const fromDatabase = await caughtUp(owner, before.seq);

    expect(fromDatabase, "ответ из базы против ответа из памяти").toEqual(fromMemory);
  });

  it("догон из памяти не ходит в базу за репликами, а из базы — ходит", async () => {
    // Одинаковый ответ ещё не значит «из памяти»: доказательство — число
    // запросов к базе, которое стенд отдаёт заголовком.
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);

    const before = await caughtUp(owner, 0);
    await send(owner, channel, "реплика для двух замеров");

    const memory = await queriesOfCatchUp(owner, before.seq);

    const folder = await call("POST", "/v1/projects", owner, { title: "Сброс хвоста" });
    expect(folder.status, "папка заведена").toBe(201);

    const database = await queriesOfCatchUp(owner, before.seq);

    expect(memory, "догон из памяти дороже, чем из базы").toBeLessThan(database);
  });

  it("реплика, выпавшая из хвоста, всё равно доезжает", async () => {
    // Хвост сброшен, а курсор остался старым: ровно случай «ноутбук
    // был закрыт». Ответ обязан прийти из базы и быть полным.
    const owner = await newPerson("Хозяин");
    const channel = await firstChannel(owner);

    const before = await caughtUp(owner, 0);
    await send(owner, channel, "первая до сброса");
    await send(owner, channel, "вторая до сброса");

    const folder = await call("POST", "/v1/projects", owner, { title: "Сброс" });
    expect(folder.status).toBe(201);

    const after = await caughtUp(owner, before.seq);
    const bodies = after.messages.map((one) => one.body);
    expect(bodies, "обе реплики после сброса хвоста").toEqual(
      expect.arrayContaining(["первая до сброса", "вторая до сброса"]),
    );
  });
});
