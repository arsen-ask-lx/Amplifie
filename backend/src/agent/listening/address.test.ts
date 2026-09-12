/**
 * Быстрые проверки распознавания обращения.
 *
 * Стек не нужен: это чистая функция над строкой. Дорогие приёмочные
 * проверяют, что обращение доезжает до модели; здесь — что оно вообще
 * различается, включая случаи, на которых легко ошибиться.
 */

import { mentionMarkup } from "@amplifie/contract";
import { describe, expect, it } from "vitest";
import { addressedById, addressedTo, awaitsAnswer } from "./address.js";

/**
 * Настоящее имя агента — латиницей.
 *
 * ⚠️ РЯДОМ ЖИВЁТ КИРИЛЛИЧЕСКОЕ ИМЯ, И ОНО ЗДЕСЬ НЕ ЗРЯ. Границу слова
 * выражение считает вручную именно потому, что `\b` в JavaScript не знает
 * кириллицы. Переименуй агента в латиницу и выброси кириллические
 * случаи — правило перестанет проверяться, а сломается оно на первом же
 * упоминании человека по русскому имени.
 */
const AGENT = "memo";

/** Имя кириллицей: так зовут людей, и так звали агента до переименования. */
const CYRILLIC_NAME = "Сводка";

describe("обращение к агенту", () => {
  it("простое обращение узнаётся", () => {
    expect(addressedTo(`@${AGENT} подведи итог`, AGENT)).toBe(true);
  });

  it("регистр не важен", () => {
    expect(addressedTo("@memo подведи итог", AGENT)).toBe(true);
    expect(addressedTo("@MEMO подведи итог", AGENT)).toBe(true);
  });

  it("обращение посреди фразы узнаётся", () => {
    expect(addressedTo(`так, @${AGENT}, что скажешь?`, AGENT)).toBe(true);
  });

  it("имя без собачки — не обращение", () => {
    // Иначе агент отвечал бы каждый раз, когда о нём просто говорят.
    expect(addressedTo("memo по неделе готова", AGENT)).toBe(false);
  });

  it("падеж — не обращение", () => {
    // Узко намеренно: угадывание склонений даёт ложные вызовы, а каждый
    // ложный вызов — это деньги и секунды.
    expect(addressedTo("@Сводкой займётся Петя", CYRILLIC_NAME)).toBe(false);
    expect(addressedTo("@Сводкам не доверяю", CYRILLIC_NAME)).toBe(false);
  });

  it("часть почтового адреса — не обращение", () => {
    expect(addressedTo("пиши на почта@memo.рф", AGENT)).toBe(false);
    expect(addressedTo("пиши на почта@Сводка.рф", CYRILLIC_NAME)).toBe(false);
  });

  it("пустое имя агента не совпадает ни с чем", () => {
    expect(addressedTo("@ кто-нибудь", "")).toBe(false);
  });

  it("буква на границе не ломает разбор", () => {
    // Латиница: `@memory` — другое слово, а не обращение к memo.
    expect(addressedTo("@memory уже не та", AGENT)).toBe(false);
    expect(addressedTo("@memo!", AGENT)).toBe(true);

    // Проверка той самой ловушки: `\b` в JavaScript не работает
    // с кириллицей, и без явных границ это выражение совпало бы.
    expect(addressedTo("@Сводкаа", CYRILLIC_NAME)).toBe(false);
    expect(addressedTo("@Сводка!", CYRILLIC_NAME)).toBe(true);
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

describe("обращение упоминанием", () => {
  const agentId = "018f3a1c-2b4d-7e8f-9a0b-1c2d3e4f5a6b";
  const humanId = "018f3a1c-2b4d-7e8f-9a0b-1c2d3e4f5a6c";

  it("выбранный из списка агент — обращение", () => {
    const body = `${mentionMarkup(AGENT, agentId)}, подведи итог`;
    expect(addressedById(body, agentId)).toBe(true);
  });

  it("упомянули человека, а не агента — не обращение", () => {
    // Иначе агент отвечал бы каждый раз, когда двое зовут друг друга.
    const body = `${mentionMarkup("Мария", humanId)}, глянь`;
    expect(addressedById(body, agentId)).toBe(false);
  });

  it("оба написания зовут одинаково", () => {
    const asText = [{ body: `@${AGENT} итог?`, authorKind: "human" }];
    const asNode = [{ body: mentionMarkup(AGENT, agentId), authorKind: "human" }];
    expect(awaitsAnswer(asText, AGENT, agentId)).toBe(true);
    expect(awaitsAnswer(asNode, AGENT, agentId)).toBe(true);
  });

  it("своё же упоминание агента не зовёт", () => {
    // Без этого выходит та же петля, что и с текстовым обращением.
    const feed = [{ body: mentionMarkup(AGENT, agentId), authorKind: "agent" }];
    expect(awaitsAnswer(feed, AGENT, agentId)).toBe(false);
  });
});
