import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesced } from "./coalesced.js";

/**
 * ТОЧЕЧНЫЕ ПРОВЕРКИ ПРАВИЛА «НЕ ЧАЩЕ РАЗА В ОКНО» (task-086).
 *
 * ⚠️ ЗДЕСЬ ТОЧЕЧНЫЕ, А НЕ СЦЕНАРИЙ, И ЭТО ОБОСНОВАНО. Правило — про ВРЕМЯ,
 * а время в сценарии браузера означает паузы: тест стал бы медленным
 * и мигающим. С поддельными часами то же правило проверяется за
 * миллисекунды и на всех границах, а не на одной.
 *
 * Две ошибки, которые здесь ловятся, и обе молчаливы:
 * ① потерять хвост — последнее изменение не показано до следующего звонка;
 * ② задержать первый вызов — счётчик непрочитанного тормозит у всех всегда.
 */

const WINDOW = 3000;

describe("не чаще раза в окно", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("первый вызов проходит немедленно", () => {
    const run = vi.fn();
    const ask = coalesced(run, WINDOW);

    ask();

    expect(run, "ждать нечего — окно закрыто не было").toHaveBeenCalledTimes(1);
  });

  it("повторы внутри окна схлопываются в один хвост", () => {
    const run = vi.fn();
    const ask = coalesced(run, WINDOW);

    ask();
    for (let n = 0; n < 9; n++) ask();
    expect(run, "внутри окна — только первый").toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WINDOW);
    expect(run, "по закрытии окна — один хвост на все девять").toHaveBeenCalledTimes(2);
  });

  it("хвост не теряется: пришедшее в окно показывается", () => {
    const run = vi.fn();
    const ask = coalesced(run, WINDOW);

    ask();
    vi.advanceTimersByTime(WINDOW - 1);
    ask(); // за миллисекунду до закрытия
    vi.advanceTimersByTime(1);

    expect(run, "последнее изменение не должно пропасть").toHaveBeenCalledTimes(2);
  });

  it("тишина не рождает лишних вызовов", () => {
    const run = vi.fn();
    const ask = coalesced(run, WINDOW);

    ask();
    vi.advanceTimersByTime(WINDOW * 10);

    expect(run, "без новых просьб хвоста быть не должно").toHaveBeenCalledTimes(1);
  });

  it("после тишины следующий вызов снова немедленный", () => {
    const run = vi.fn();
    const ask = coalesced(run, WINDOW);

    ask();
    vi.advanceTimersByTime(WINDOW * 2);
    ask();

    expect(run, "окно закрылось — ждать снова нечего").toHaveBeenCalledTimes(2);
  });
});
