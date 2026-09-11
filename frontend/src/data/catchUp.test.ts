/**
 * ПРОВЕРКИ ДОГОНА НА КЛИЕНТЕ (task-039, шаг 4; task-027 №11).
 *
 * Прежде догон бросал работу после 20 страниц, даже когда сервер говорил
 * «есть ещё»: вкладка, отставшая больше чем на тысячу изменений, так
 * и не получала хвост. А два звонка подряд запускали два догона на одном
 * курсоре разом.
 */
import { describe, expect, it } from "vitest";
import type { SyncLine } from "./api.js";
import { catchUpWith, type SyncPage } from "./catchUp.js";

/** Принятое догоном в этих проверках не нужно — важен сам ход догона. */
const dropLines = (lines: SyncLine[]) => void lines;

function line(n: number): SyncLine {
  return { id: `id-${n}`, conversationId: "комната", seq: n, deleted: true };
}

/** Сервер с `pages` страницами по одной строке; номер = номер строки. */
function server(pages: number) {
  const calls: number[] = [];
  const fetchPage = async (after: number): Promise<SyncPage> => {
    calls.push(after);
    const next = after + 1;
    if (next > pages) return { messages: [], seq: pages, hasMore: false };
    return { messages: [line(next)], seq: next, hasMore: next < pages };
  };
  return { calls, fetchPage };
}

describe("догон на клиенте", () => {
  it("доходит до конца, даже если страниц больше двадцати", async () => {
    const { fetchPage } = server(25);
    const cursor = { current: 0 };
    const got: SyncLine[] = [];

    await catchUpWith(fetchPage, cursor, (lines) => got.push(...lines))();

    expect(got).toHaveLength(25);
    expect(cursor.current).toBe(25);
  });

  it("не крутится вечно, если сервер не двигает курсор", async () => {
    let calls = 0;
    const stuck = async (after: number): Promise<SyncPage> => {
      calls += 1;
      return { messages: [], seq: after, hasMore: true };
    };
    await catchUpWith(stuck, { current: 7 }, dropLines)();
    expect(calls).toBe(1);
  });

  it("звонок во время догона не запускает второй — но даёт ещё один проход после", async () => {
    const { calls, fetchPage } = server(3);
    const cursor = { current: 0 };
    const run = catchUpWith(fetchPage, cursor, dropLines);

    const first = run();
    const second = run();
    await Promise.all([first, second]);

    // Один проход до конца (1, 2, 3 и пустая) — и один повтор после звонка:
    // пришедшее во время первого прохода обязано быть забрано.
    const concurrent = calls.filter((after, i) => calls.indexOf(after) !== i && after < 3);
    expect(concurrent, "два догона шли по одному курсору разом").toEqual([]);
    expect(calls.at(-1)).toBe(3);
  });
});
