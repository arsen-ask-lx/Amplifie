/**
 * Проверки записи упоминания.
 *
 * Здесь стережётся ровно одно: что упоминанием считается НЕ всякая
 * скобка с собачкой. Ошибись в эту сторону — и бек начнёт отклонять
 * сообщения, которые люди писали годами.
 */
import { describe, expect, it } from "vitest";
import { mentionedIds, mentionMarkup } from "./mentions.js";

const MARIA = "018f3a1c-2b4d-7e8f-9a0b-1c2d3e4f5a6b";
const PETR = "018f3a1c-2b4d-7e8f-9a0b-1c2d3e4f5a6c";

describe("запись упоминания", () => {
  it("собранное читается обратно", () => {
    expect(mentionedIds(`привет, ${mentionMarkup("Мария Петрова", MARIA)}`)).toEqual([MARIA]);
  });

  it("двоих зовут двумя номерами", () => {
    const body = `${mentionMarkup("Мария", MARIA)} и ${mentionMarkup("Пётр", PETR)}`;
    expect(mentionedIds(body).sort()).toEqual([MARIA, PETR].sort());
  });

  it("одного дважды — это один зов", () => {
    const body = `${mentionMarkup("Мария", MARIA)}, ещё раз ${mentionMarkup("Мария", MARIA)}`;
    expect(mentionedIds(body)).toEqual([MARIA]);
  });

  it("обычная ссылка упоминанием не считается", () => {
    expect(mentionedIds("[сайт](https://example.com)")).toEqual([]);
  });

  it("скобка с собачкой, но без номера — не упоминание", () => {
    // Так пишут годами, и отклонять такие сообщения нельзя.
    expect(mentionedIds("[почта](@example.com)")).toEqual([]);
    expect(mentionedIds("[тут](@там)")).toEqual([]);
  });

  it("имя без скобок — не упоминание", () => {
    expect(mentionedIds("@Мария Петрова, глянь")).toEqual([]);
  });

  it("повторный вызов даёт тот же ответ", () => {
    // Общая глобальная регулярка помнила бы lastIndex и через раз
    // возвращала пусто. Тест ровно на это.
    const body = mentionMarkup("Мария", MARIA);
    expect(mentionedIds(body), "первый вызов").toEqual([MARIA]);
    expect(mentionedIds(body), "второй вызов").toEqual([MARIA]);
    expect(mentionedIds(body), "третий вызов").toEqual([MARIA]);
  });
});
