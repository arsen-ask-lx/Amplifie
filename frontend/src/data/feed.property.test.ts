import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Message, SyncLine } from "./api.js";
import { merge, mergePinned } from "./feed.js";
import { TEST_ROOM, testLine } from "./feedLines.js";

/**
 * Свойства слияния ленты (task-121): догон, пришедший дважды, в любом порядке
 * и с правками старого, не теряет и не задваивает реплики. Примеры — в
 * `merge.test.ts`; здесь — тысячи сочетаний, которые руками не придумать.
 */
const RUNS = { numRuns: 300 };
const ROOM = TEST_ROOM;
const message = testLine;

/** Небольшой набор номеров реплик: так догон часто задевает уже показанное. */
const id = fc.integer({ min: 1, max: 12 }).map((n) => `m${n}`);
const seqOf = (one: string) => Number(one.slice(1));

/** Лента: реплики с разными номерами, отсортированные — как её держит клиент. */
const feed = fc
  .uniqueArray(id, { maxLength: 10 })
  .map((ids) =>
    ids.map((one) => message(one, seqOf(one), `было ${one}`)).sort((a, b) => a.seq - b.seq),
  );

/** Догон: новые, правки и надгробия, по одной строке на реплику. */
const catchUp = fc.uniqueArray(
  fc
    .tuple(id, fc.boolean(), fc.string({ maxLength: 5 }))
    .map(
      ([one, dead, body]): SyncLine =>
        dead
          ? { id: one, conversationId: ROOM, seq: seqOf(one), deleted: true }
          : message(one, seqOf(one), `стало ${body}`),
    ),
  { selector: (line) => line.id, maxLength: 10 },
);

const ids = (lines: Message[]) => lines.map((one) => one.id);

describe("слияние ленты: свойства", () => {
  it("повторный догон ничего не меняет", () => {
    fc.assert(
      fc.property(feed, catchUp, (current, incoming) => {
        const once = merge(current, incoming);
        expect(merge(once, incoming)).toEqual(once);
      }),
      RUNS,
    );
  });

  it("лента по номерам и без дублей", () => {
    fc.assert(
      fc.property(feed, catchUp, (current, incoming) => {
        const result = merge(current, incoming);
        const seqs = result.map((one) => one.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(ids(result)).size).toBe(result.length);
      }),
      RUNS,
    );
  });

  it("живое из догона — в ленте как пришло, удалённого нет, прочее не пропало", () => {
    fc.assert(
      fc.property(feed, catchUp, (current, incoming) => {
        const result = merge(current, incoming);
        const shown = new Map(result.map((one) => [one.id, one]));
        const removed = new Set(
          incoming.filter((line) => "deleted" in line).map((line) => line.id),
        );
        for (const line of incoming)
          expect(shown.get(line.id)).toEqual(removed.has(line.id) ? undefined : line);
        const kept = current.filter((one) => !removed.has(one.id)).map((one) => one.id);
        expect(kept.filter((one) => !shown.has(one))).toEqual([]);
      }),
      RUNS,
    );
  });

  // На непустом догоне: пустой ничего не трогает, даже окно, — лента уже
  // обрезана прошлыми слияниями, а та же ссылка бережёт перерисовку.
  it("окно режет сверху: остаётся хвост, не больше окна", () => {
    fc.assert(
      fc.property(feed, catchUp, fc.integer({ min: 1, max: 8 }), (current, incoming, keep) => {
        fc.pre(incoming.length > 0);
        const whole = merge(current, incoming);
        const cut = merge(current, incoming, keep);
        expect(cut).toEqual(whole.slice(-keep));
      }),
      RUNS,
    );
  });

  it("пустой догон — та же лента, та же ссылка", () => {
    fc.assert(
      fc.property(feed, (current) => {
        expect(merge(current, [])).toBe(current);
      }),
      RUNS,
    );
  });

  it("закреплённое: свежие сверху, без дублей; ничего не изменилось — та же ссылка", () => {
    const pinned = fc
      .uniqueArray(id, { maxLength: 6 })
      .map((list) =>
        list
          .map((one) =>
            message(one, seqOf(one), one, `2026-09-${String(seqOf(one) + 10)}T00:00:00.000Z`),
          )
          .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")),
      );
    fc.assert(
      fc.property(pinned, catchUp, (current, incoming) => {
        const result = mergePinned(current, incoming, ROOM);
        const at = result.map((one) => one.pinnedAt ?? "");
        expect(at).toEqual([...at].sort().reverse());
        expect(new Set(ids(result)).size).toBe(result.length);
        expect(mergePinned(current, [], ROOM)).toBe(current);
      }),
      RUNS,
    );
  });
});
