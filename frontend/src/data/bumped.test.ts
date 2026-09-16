import { describe, expect, it } from "vitest";
import type { Conversation, Message } from "./api.js";
import { bumped } from "./bumped.js";

/**
 * ТОЧЕЧНЫЕ ПРОВЕРКИ ПРАВИЛА «СТРОКА ПАНЕЛИ ПОСЛЕ ПРИЕХАВШЕЙ РЕПЛИКИ»
 * (task-092).
 *
 * ⚠️ ЗДЕСЬ ТОЧЕЧНЫЕ, И ЭТО ГЛАВНАЯ СТРАХОВКА ЗАДАЧИ. С этой правкой
 * счётчик непрочитанного впервые считается НЕ на сервере, и ошибка в нём
 * не видна ни замером, ни типами: она видна человеку через день как
 * «висит единичка, а читать нечего» либо, хуже, как непоказанный зов.
 * Само правило — чистая функция без единой зависимости, и проверять его
 * сценарием браузера значило бы мерить браузер.
 */

const HOUR_AGO = "2026-09-16T11:00:00.000Z";
const NOW = "2026-09-16T12:00:00.000Z";

const ME = "me-1";
const FRIEND = "friend-1";

function room(edit: Partial<Conversation> = {}): Conversation {
  return {
    id: "room-1",
    kind: "channel",
    title: "Смета",
    parentId: null,
    projectId: null,
    lastAt: HOUR_AGO,
    unread: 0,
    mentions: 0,
    readSeq: 10,
    pinned: false,
    moderator: false,
    ...edit,
  };
}

function line(edit: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    clientMsgId: "client-1",
    conversationId: "room-1",
    body: "готово",
    kind: "human",
    seq: 11,
    createdAt: NOW,
    editedAt: null,
    pinnedAt: null,
    author: { id: FRIEND, name: "Друг", kind: "human" },
    replyTo: null,
    forwardedFrom: null,
    ...edit,
  };
}

describe("строка панели после приехавшей реплики", () => {
  it("чужая реплика в неоткрытом чате — плюс один непрочитанный", () => {
    const after = bumped([room()], line(), { me: ME, openId: null, mentioned: [] });
    expect(after[0]?.unread).toBe(1);
  });

  it("свежесть строки — время реплики: по нему сервер и сортирует", () => {
    const after = bumped([room()], line(), { me: ME, openId: null, mentioned: [] });
    expect(after[0]?.lastAt).toBe(NOW);
  });

  it("моя собственная реплика непрочитанной не считается", () => {
    // Р-029: непрочитанное — это ЧУЖИЕ реплики. Считай мы свои,
    // человек видел бы значок на чате, в котором сам только что написал.
    const mine = line({ author: { id: ME, name: "Я", kind: "human" } });
    const after = bumped([room()], mine, { me: ME, openId: null, mentioned: [] });
    expect(after[0]?.unread).toBe(0);
    // Но строка всё равно всплывает: в чате говорили.
    expect(after[0]?.lastAt).toBe(NOW);
  });

  it("в открытом чате непрочитанного не прибавляется", () => {
    // Человек смотрит на реплику прямо сейчас. Прибавь мы счётчик,
    // он бы мигал и гас на каждое сообщение у всех на глазах.
    const after = bumped([room()], line(), { me: ME, openId: "room-1", mentioned: [] });
    expect(after[0]?.unread).toBe(0);
  });

  it("позвали меня — плюс один зов (Р-031)", () => {
    const after = bumped([room()], line(), { me: ME, openId: null, mentioned: [ME] });
    expect(after[0]?.mentions).toBe(1);
    expect(after[0]?.unread).toBe(1);
  });

  it("позвали не меня — зов чужой, счётчик не мой", () => {
    const after = bumped([room()], line(), { me: ME, openId: null, mentioned: ["someone-else"] });
    expect(after[0]?.mentions).toBe(0);
  });

  it("позвали в ОТКРЫТОМ чате — зов тоже не считается: человек его видит", () => {
    const after = bumped([room()], line(), { me: ME, openId: "room-1", mentioned: [ME] });
    expect(after[0]?.mentions).toBe(0);
  });

  it("реплика в незагруженный чат ничего не портит", () => {
    // Панель грузит порциями (Р-037): строки может не быть вовсе.
    // Выдумывать её нельзя — у выдуманной нет ни прав, ни названия.
    const others = [room({ id: "room-2" })];
    const after = bumped(others, line(), { me: ME, openId: null, mentioned: [] });
    expect(after).toEqual(others);
  });

  it("чужие строки не трогаются", () => {
    const rooms = [room(), room({ id: "room-2", unread: 7, lastAt: HOUR_AGO })];
    const after = bumped(rooms, line(), { me: ME, openId: null, mentioned: [] });
    expect(after[1]).toEqual(rooms[1]);
  });

  it("счётчик растёт от каждой реплики, а не встаёт на единице", () => {
    const first = bumped([room()], line(), { me: ME, openId: null, mentioned: [] });
    const second = bumped(first, line({ seq: 12, id: "msg-2" }), {
      me: ME,
      openId: null,
      mentioned: [],
    });
    expect(second[0]?.unread).toBe(2);
  });

  it("реплика в ветке канал НЕ трогает — сервер тоже не трогает", () => {
    // ⚠️ ПРОВЕРЕНО ЧТЕНИЕМ ЗАПРОСА, А НЕ ПРЕДПОЛОЖЕНО. В `listConversationsFor`
    // и свежесть, и непрочитанное считаются по репликам ЭТОГО разговора
    // (`message.conversation_id = conversation.id`), и ветка в счёт канала
    // не входит. Свернём ветку в канал на клиенте — и панель разойдётся
    // с сервером при первом же полном перечитывании: число подпрыгнет
    // и молча упадёт обратно.
    const rooms = [room({ id: "channel-1" })];
    const inThread = line({ conversationId: "thread-1" });
    expect(bumped(rooms, inThread, { me: ME, openId: null, mentioned: [] })).toEqual(rooms);
  });
});
