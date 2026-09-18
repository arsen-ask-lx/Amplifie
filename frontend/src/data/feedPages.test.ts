/**
 * КОГДА ЛЕНТА ГРУЗИТ СТРАНИЦУ, А КОГДА ПРОСТО ВЕДЁТ ВЗГЛЯД (task-106).
 *
 * ⚠️ ЭТО ПРАВИЛО КОПИЛОСЬ ТРЕМЯ МИГАНИЯМИ, и каждое вернулось бы тихо:
 * лишняя загрузка выглядит как «чуть дёрнулось», а пропущенная — как
 * «не открылось». Поэтому у правила свой арбитр, а не только прогон
 * интерфейса.
 */
import { describe, expect, it } from "vitest";
import type { Message } from "./api.js";
import { needsPage } from "./feedPages.js";

const ROOM = "комната-1";

function line(seq: number): Message {
  return {
    id: `m${seq}`,
    clientMsgId: `m${seq}`,
    conversationId: ROOM,
    body: `строка ${seq}`,
    kind: "text",
    seq,
    createdAt: "2026-09-18T10:00:00.000Z",
    editedAt: null,
    pinnedAt: null,
    author: { id: "автор", name: "Автор", kind: "human" },
    replyTo: null,
    forwardedFrom: null,
  };
}

const window = [line(10), line(11), line(12)];

describe("нужна ли страница ленты", () => {
  it("другой чат — грузим всегда", () => {
    expect(
      needsPage({ shown: "другая", currentId: ROOM, wanted: null, hasNewer: false, messages: [] }),
    ).toBe(true);
    expect(
      needsPage({ shown: null, currentId: ROOM, wanted: 11, hasNewer: false, messages: window }),
    ).toBe(true);
  });

  it("тот же чат без номера: в конце не грузим, из давнего — грузим", () => {
    const same = { shown: ROOM, currentId: ROOM, wanted: null, messages: window };
    expect(needsPage({ ...same, hasNewer: false })).toBe(false);
    // Не в конце: «назад» и щелчок по чату обязаны показать конец (task-099).
    expect(needsPage({ ...same, hasNewer: true })).toBe(true);
  });

  it("номер уже в окне — не грузим, даже если лента в давнем", () => {
    const same = { shown: ROOM, currentId: ROOM, messages: window };
    expect(needsPage({ ...same, wanted: 11, hasNewer: false })).toBe(false);
    expect(needsPage({ ...same, wanted: 11, hasNewer: true })).toBe(false);
  });

  it("номер за краем окна — грузим", () => {
    const same = { shown: ROOM, currentId: ROOM, messages: window, hasNewer: false };
    expect(needsPage({ ...same, wanted: 9 })).toBe(true);
    expect(needsPage({ ...same, wanted: 13 })).toBe(true);
  });

  it("черновик номером не считается: у него дробный номер и его нет на сервере", () => {
    const draft = { ...line(12), seq: 12.5 };
    expect(
      needsPage({
        shown: ROOM,
        currentId: ROOM,
        wanted: 12.5,
        hasNewer: false,
        messages: [...window, draft],
      }),
    ).toBe(true);
  });
});
