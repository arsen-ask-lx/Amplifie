/**
 * ПРОВЕРКИ СЛИЯНИЯ ДОГОНА В ЛЕНТУ (change `chat-edit-delete-sync`).
 *
 * ⚠️ ПРОВЕРЯЕТСЯ РОВНО ТО, ЧТО НАЗВАНО РИСКОМ В УСТРОЙСТВЕ: догон теперь
 * может принести реплику, которая у клиента уже есть. Раньше он приносил
 * только новое, и «дописать в конец» было верно; теперь дописывание
 * задваивало бы исправленную реплику. Задвоение — из тех поломок, что
 * видно только глазами и только у второго человека, поэтому здесь
 * не рассуждение, а арбитр.
 */
import { describe, expect, it } from "vitest";
import type { Message, SyncLine, Tombstone } from "./api.js";
import { merge, mergePinned } from "./useChat.js";

const ROOM = "комната-1";

function line(id: string, seq: number, body: string, pinnedAt: string | null = null): Message {
  return {
    id,
    conversationId: ROOM,
    body,
    kind: "text",
    seq,
    createdAt: "2026-09-08T10:00:00.000Z",
    editedAt: null,
    pinnedAt,
    author: { id: "автор", name: "Автор", kind: "human" },
    replyTo: null,
    forwardedFrom: null,
  };
}

const grave = (id: string, seq: number): Tombstone => ({
  id,
  conversationId: ROOM,
  seq,
  deleted: true,
});

describe("слияние догона в ленту", () => {
  it("новая реплика дописывается", () => {
    const got = merge([line("a", 1, "раз")], [line("b", 2, "два")]);
    expect(got.map((m) => m.body)).toEqual(["раз", "два"]);
  });

  it("исправленная реплика замещает прежнюю, а не встаёт второй", () => {
    const got = merge([line("a", 1, "было"), line("b", 2, "два")], [line("a", 1, "стало")]);
    expect(got).toHaveLength(2);
    expect(got[0]?.body).toBe("стало");
  });

  it("исправленная старая реплика остаётся на своём месте", () => {
    // Догон упорядочен по номеру ИЗМЕНЕНИЯ, поэтому правка первой реплики
    // приезжает последней. Место в разговоре при этом прежнее.
    const было = [line("a", 1, "первая"), line("b", 2, "вторая"), line("c", 3, "третья")];
    const got = merge(было, [line("a", 1, "исправленная первая")]);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(got[0]?.body).toBe("исправленная первая");
  });

  it("надгробие убирает реплику, а не оставляет пустую", () => {
    const got = merge([line("a", 1, "раз"), line("b", 2, "два")], [grave("a", 1)]);
    expect(got.map((m) => m.id)).toEqual(["b"]);
  });

  it("надгробие на незнакомую реплику ничего не ломает", () => {
    const было = [line("a", 1, "раз")];
    expect(merge(было, [grave("щ", 9)])).toHaveLength(1);
  });

  it("повторный догон ленту не меняет", () => {
    const было = [line("a", 1, "раз"), line("b", 2, "два")];
    const пришло: SyncLine[] = [line("a", 1, "раз")];
    expect(merge(merge(было, пришло), пришло)).toEqual(merge(было, пришло));
  });

  it("пустой догон возвращает ту же ленту, а не её копию", () => {
    const было = [line("a", 1, "раз")];
    expect(merge(было, [])).toBe(было);
  });
});

describe("слияние догона в полоску закреплённого", () => {
  it("закрепление добавляет реплику в полоску", () => {
    const got = mergePinned([], [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")], ROOM);
    expect(got.map((m) => m.id)).toEqual(["a"]);
  });

  it("открепление убирает", () => {
    const было = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(было, [line("a", 1, "важное", null)], ROOM)).toEqual([]);
  });

  it("удаление закреплённого убирает и из полоски", () => {
    const было = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(было, [grave("a", 1)], ROOM)).toEqual([]);
  });

  it("свежее закрепление сверху", () => {
    const было = [line("a", 1, "раннее", "2026-09-08T10:00:00.000Z")];
    const got = mergePinned(было, [line("b", 2, "позднее", "2026-09-08T12:00:00.000Z")], ROOM);
    expect(got.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("чужая комната полоску не трогает", () => {
    const было = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    const чужое = { ...line("z", 5, "не тут", "2026-09-08T11:00:00.000Z"), conversationId: "друг" };
    expect(mergePinned(было, [чужое], ROOM)).toBe(было);
  });

  it("без открытой комнаты полоска не трогается", () => {
    const было = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(было, [grave("a", 1)], null)).toBe(было);
  });
});
