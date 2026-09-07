/**
 * Быстрые проверки распознавания обращения.
 *
 * Стек не нужен: это чистая функция над строкой. Дорогие приёмочные
 * проверяют, что обращение доезжает до модели; здесь — что оно вообще
 * различается, включая случаи, на которых легко ошибиться.
 */
import { describe, expect, it } from "vitest";
import { addressedTo, awaitsAnswer } from "./address.js";

const AGENT = "Сводка";

describe("обращение к агенту", () => {
  it("простое обращение узнаётся", () => {
    expect(addressedTo(`@${AGENT} подведи итог`, AGENT)).toBe(true);
  });

  it("регистр не важен", () => {
    expect(addressedTo("@сводка подведи итог", AGENT)).toBe(true);
    expect(addressedTo("@СВОДКА подведи итог", AGENT)).toBe(true);
  });

  it("обращение посреди фразы узнаётся", () => {
    expect(addressedTo(`так, @${AGENT}, что скажешь?`, AGENT)).toBe(true);
  });

  it("имя без собачки — не обращение", () => {
    // Иначе агент отвечал бы каждый раз, когда о нём просто говорят.
    expect(addressedTo("сводка по неделе готова", AGENT)).toBe(false);
  });

  it("падеж — не обращение", () => {
    // Узко намеренно: угадывание склонений даёт ложные вызовы, а каждый
    // ложный вызов — это деньги и секунды.
    expect(addressedTo("@Сводкой займётся Петя", AGENT)).toBe(false);
    expect(addressedTo("@Сводкам не доверяю", AGENT)).toBe(false);
  });

  it("часть почтового адреса — не обращение", () => {
    expect(addressedTo("пиши на почта@Сводка.рф", AGENT)).toBe(false);
  });

  it("пустое имя агента не совпадает ни с чем", () => {
    expect(addressedTo("@ кто-нибудь", "")).toBe(false);
  });

  it("буква на границе не ломает разбор", () => {
    // Проверка той самой ловушки: `\b` в JavaScript не работает
    // с кириллицей, и без явных границ это выражение совпало бы.
    expect(addressedTo("@Сводкаа", AGENT)).toBe(false);
    expect(addressedTo("@Сводка!", AGENT)).toBe(true);
  });
});

describe("ждёт ли разговор ответа", () => {
  it("последнее слово человека с обращением — ждёт", () => {
    // Лента в порядке чтения: обращение стоит ПОСЛЕДНИМ.
    const feed = [
      { body: "болтали о смете", authorKind: "human" },
      { body: `@${AGENT} итог?`, authorKind: "human" },
    ];
    expect(awaitsAnswer(feed, AGENT)).toBe(true);
  });

  it("обращение не последним словом — не ждёт", () => {
    // Агента звали, но потом разговор поехал дальше. Отвечать поздно.
    const feed = [
      { body: `@${AGENT} итог?`, authorKind: "human" },
      { body: "а, уже не надо", authorKind: "human" },
    ];
    expect(awaitsAnswer(feed, AGENT)).toBe(false);
  });

  it("обращение в собственной реплике агента не считается", () => {
    // Без этого выходит петля: агент отвечает текстом с обращением,
    // следующий разбор видит его и зовёт агента снова.
    const feed = [{ body: `@${AGENT} и тебе привет`, authorKind: "agent" }];
    expect(awaitsAnswer(feed, AGENT)).toBe(false);
  });

  it("пустая лента не ждёт ничего", () => {
    expect(awaitsAnswer([], AGENT)).toBe(false);
  });
});
