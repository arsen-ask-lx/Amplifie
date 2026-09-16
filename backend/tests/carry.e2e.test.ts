/**
 * ПРИЁМОЧНЫЕ: СОБЫТИЕ НЕСЁТ САМУ РЕПЛИКУ (task-085).
 * Написаны ДО кода и обязаны быть красными.
 *
 * ⚠️ ЗДЕСЬ ПОЯВЛЯЕТСЯ ВТОРАЯ ДОРОГА К ОДНИМ ДАННЫМ, и это самый опасный
 * вид кода: разойдясь, дороги разойдутся молча и у части людей. Поэтому
 * главная проверка тут не «приехало», а «приехало ТО ЖЕ САМОЕ»: объект
 * из события сравнивается с ответом догона целиком, поле в поле.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, listenCalls, newPerson, type Person, requireStand } from "./stand.js";

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

async function said(person: Person, conversationId: string, body: string) {
  const response = await call("POST", `/v1/conversations/${conversationId}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status, "отправка").toBe(201);
  return (await response.json()) as { id: string; seq: number };
}

describe("событие несёт саму реплику", () => {
  beforeAll(requireStand);

  it("участнику приезжает реплика, а не только адрес", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Коллега");
    const channel = await firstChannel(owner);

    // Поток открывается ДО отправки: звонок, пролетевший раньше подписки,
    // потерян, и тест соврал бы «не пришло».
    const stream = await listenCalls(mate);
    try {
      await said(owner, channel, "привет из события");
      const heard = await stream.next();

      expect(heard?.conversation, "адрес на месте").toBe(channel);
      expect(heard?.line, "реплика приехала самим событием").toMatchObject({
        conversationId: channel,
        body: "привет из события",
      });
    } finally {
      stream.stop();
    }
  });

  it("объект из события совпадает с ответом догона целиком", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Коллега");
    const channel = await firstChannel(owner);

    // Курсор берём ДО отправки, чтобы догон вернул ровно эту реплику.
    const before = (await (await call("GET", "/v1/sync?after=0&limit=50", mate)).json()) as {
      seq: number;
    };

    const stream = await listenCalls(mate);
    let fromEvent: unknown;
    try {
      await said(owner, channel, "одна дорога, два способа доехать");
      fromEvent = (await stream.next())?.line;
    } finally {
      stream.stop();
    }

    const page = (await (
      await call("GET", `/v1/sync?after=${before.seq}&limit=50`, mate)
    ).json()) as { messages: unknown[] };

    expect(page.messages, "догон отдал ровно одну строку").toHaveLength(1);
    // ⚠️ ЦЕЛИКОМ, А НЕ ВЫБОРОЧНО. Разойтись эти два объекта могут в любом
    // поле — во времени, в цитате, в имени автора, — и разойдутся молча.
    expect(fromEvent, "событие и догон отдают одно и то же").toEqual(page.messages[0]);
  });

  it("постороннему не приходит ни события, ни содержимого", async () => {
    const owner = await newPerson("Хозяин");
    const outsider = await colleague(owner, "Посторонний");

    const made = await call("POST", "/v1/conversations", owner, {
      title: "Только для своих",
      visibility: "private",
    });
    const closed = (await made.json()) as { id: string };

    const stream = await listenCalls(outsider);
    try {
      await said(owner, closed.id, "секрет");
      const heard = await stream.next(1500);
      // Не «поле пустое», а «звонка нет вовсе»: адрес закрытого чата —
      // тоже сведение о нём.
      expect(heard, "постороннему не звонят о закрытом чате").toBeNull();
    } finally {
      stream.stop();
    }
  });

  it("правка приезжает без содержимого — её хвост описать не умеет", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Коллега");
    const channel = await firstChannel(owner);
    const written = await said(owner, channel, "было");

    const stream = await listenCalls(mate);
    try {
      const edited = await call("PATCH", `/v1/messages/${written.id}`, owner, { body: "стало" });
      expect(edited.status, "правка").toBe(200);

      const heard = await stream.next();
      expect(heard?.conversation, "адрес правки").toBe(channel);
      expect(heard?.line, "правку сервер описать точно не умеет").toBeUndefined();
    } finally {
      stream.stop();
    }
  });
});
