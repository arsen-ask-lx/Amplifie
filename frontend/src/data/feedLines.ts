import type { Message } from "./api.js";

/**
 * Реплика для проверок слияния ленты — одна на примеры (`merge.test.ts`) и свойства
 * (`feed.property.test.ts`): форма ответа сервера меняется в одном месте.
 */
export const TEST_ROOM = "комната-1";

export function testLine(
  id: string,
  seq: number,
  body: string,
  pinnedAt: string | null = null,
): Message {
  return {
    id,
    clientMsgId: id,
    conversationId: TEST_ROOM,
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
