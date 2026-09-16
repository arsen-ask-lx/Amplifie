/**
 * Как вкладка-подделка режет поток на события.
 *
 * ⚠️ КУСОК ИЗ СОКЕТА — НЕ СОБЫТИЕ. Под нагрузкой сервер пишет быстрее,
 * чем держатель читает, и в один `read()` приезжают два события сразу
 * либо половина одного. Прибор, считавший кусок событием, терял второе,
 * видел «разрыв» и шёл в догон — и 3000 таких вкладок устраивали серверу
 * шторм, которого у браузера с `EventSource` не бывает (task-091).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { framed } from "./sse.mjs";

const event = (seq) => `event: changed\ndata: {"line":{"seq":${seq}}}\n\n`;

describe("поток режется на события, а не на куски", () => {
  it("два события в одном куске — оба", () => {
    const { events, rest } = framed(event(1) + event(2));
    assert.deepEqual(events, [event(1).trim(), event(2).trim()]);
    assert.equal(rest, "");
  });

  it("событие, разрезанное пополам, не отдаётся, пока не дочитано", () => {
    const whole = event(7);
    const first = framed(whole.slice(0, 20));
    assert.deepEqual(first.events, []);
    const second = framed(first.rest + whole.slice(20));
    assert.deepEqual(second.events, [whole.trim()]);
    assert.equal(second.rest, "");
  });

  it("сердцебиение без данных событием не считается", () => {
    const { events } = framed(`: тук\n\n${event(3)}`);
    assert.deepEqual(events, [event(3).trim()]);
  });
});
