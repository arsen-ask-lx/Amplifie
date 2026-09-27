/**
 * Отметки «прочитано» по образцу Telegram Desktop (task-097).
 *
 * Часы и таймеры поддельные: окно в три секунды проверяется числами,
 * а не ожиданием.
 */
import { describe, expect, it } from "vitest";
import { READ_WINDOW_MS, readMarks } from "./readMarks.js";

const settle = async () => {
  for (let n = 0; n < 10; n++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function harness() {
  let clock = 0;
  let timers: Array<{ at: number; run: () => void; cleared: boolean }> = [];
  const sent: Array<{
    id: string;
    seq: number;
    answer: (unread: number) => void;
    fail: () => void;
  }> = [];
  const reported: string[] = [];
  const marks = readMarks((id, seq, unread) => reported.push(`${id}:${seq}:${unread}`), {
    send: (id, seq) =>
      new Promise((resolve, reject) => {
        sent.push({
          id,
          seq,
          answer: (unread) => resolve({ unread }),
          fail: () => reject(new Error("отказ")),
        });
      }),
    now: () => clock,
    setTimeout: (run, ms) => {
      const timer = { at: clock + ms, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  /** Прожить время: сработают таймеры, чей срок наступил. */
  const pass = (ms: number) => {
    clock += ms;
    const due = timers.filter((one) => !one.cleared && one.at <= clock);
    timers = timers.filter((one) => !due.includes(one));
    for (const one of due) one.run();
  };
  /** Сколько таймеров ещё стоит: не сработали и не сняты. */
  const armed = () => timers.filter((one) => !one.cleared).length;
  return { marks, sent, reported, pass, armed };
}

describe("отметки «прочитано»", () => {
  it("первая уходит сразу, следующая — не раньше окна", async () => {
    const h = harness();
    h.marks.seen("a", 10);
    expect(h.sent.map((one) => one.seq)).toEqual([10]);
    h.sent[0]?.answer(0);
    await settle();

    h.marks.seen("a", 11);
    expect(h.sent).toHaveLength(1);
    h.pass(READ_WINDOW_MS - 1);
    expect(h.sent).toHaveLength(1);
    h.pass(1);
    expect(h.sent.map((one) => one.seq)).toEqual([10, 11]);
  });

  it("новые реплики не сдвигают окно — уходит последний номер в свой срок", async () => {
    const h = harness();
    h.marks.seen("a", 1);
    h.sent[0]?.answer(0);
    await settle();
    for (let seq = 2; seq <= 9; seq++) {
      h.pass(300);
      h.marks.seen("a", seq);
    }
    // 8 × 300 мс = 2400 мс прожито; до окна ещё 600 мс.
    h.pass(600);
    expect(h.sent.map((one) => one.seq)).toEqual([1, 9]);
  });

  it("два чата не затирают друг друга", () => {
    const h = harness();
    h.marks.seen("a", 5);
    h.marks.seen("b", 7);
    expect(h.sent.map((one) => `${one.id}:${one.seq}`)).toEqual(["a:5", "b:7"]);
  });

  it("в пути не больше одного запроса на чат; новое уходит после ответа", async () => {
    const h = harness();
    h.marks.seen("a", 1);
    h.pass(READ_WINDOW_MS);
    h.marks.seen("a", 2);
    expect(h.sent).toHaveLength(1);
    h.sent[0]?.answer(1);
    await settle();
    expect(h.sent.map((one) => one.seq)).toEqual([1, 2]);
  });

  it("уход из чата отправляет отложенное, не дожидаясь окна", async () => {
    const h = harness();
    h.marks.seen("a", 1);
    h.sent[0]?.answer(0);
    await settle();
    h.marks.seen("a", 2);
    expect(h.sent).toHaveLength(1);
    h.marks.flush("a");
    expect(h.sent.map((one) => one.seq)).toEqual([1, 2]);
  });

  it("отказ не теряет отметку: тот же номер уходит при следующем взгляде", async () => {
    const h = harness();
    h.marks.seen("a", 4);
    h.sent[0]?.fail();
    await settle();
    expect(h.reported).toEqual([]);
    h.pass(READ_WINDOW_MS);
    h.marks.seen("a", 4);
    expect(h.sent.map((one) => one.seq)).toEqual([4, 4]);
  });

  it("номер не дальше уже желаемого или подтверждённого — ничего", async () => {
    const h = harness();
    h.marks.seen("a", 8);
    h.marks.seen("a", 8);
    h.marks.seen("a", 3);
    h.sent[0]?.answer(0);
    await settle();
    h.pass(READ_WINDOW_MS);
    h.marks.seen("a", 8);
    expect(h.sent).toHaveLength(1);
  });

  it("ответ сообщает номер и остаток от сервера", async () => {
    const h = harness();
    h.marks.seen("a", 6);
    h.sent[0]?.answer(2);
    await settle();
    expect(h.reported).toEqual(["a:6:2"]);
  });

  it("после остановки ответы не сообщаются", async () => {
    const h = harness();
    h.marks.seen("a", 1);
    h.sent[0]?.answer(0);
    await settle();
    h.marks.seen("a", 2);
    h.marks.flushAll();
    h.marks.stop();
    h.sent[1]?.answer(0);
    await settle();
    h.pass(READ_WINDOW_MS * 2);
    expect(h.sent.map((one) => one.seq)).toEqual([1, 2]);
    expect(h.reported).toEqual(["a:1:0"]);
  });

  it("остановка снимает таймер отложенной отметки", async () => {
    const h = harness();
    h.marks.seen("a", 1);
    h.sent[0]?.answer(0);
    await settle();
    h.marks.seen("a", 2);
    // Положительный контроль: отметка отложена, и таймер к окну стоит (сколько —
    // устройство, не поведение; поведение — что после остановки не висит ни одного).
    expect(h.armed()).toBeGreaterThan(0);
    h.marks.stop();
    expect(h.armed()).toBe(0);
    // Сопутствующее: и после двух окон ничего не ушло.
    h.pass(READ_WINDOW_MS * 2);
    expect(h.sent.map((one) => one.seq)).toEqual([1]);
  });
});
