/**
 * Слова поиска (task-100): одно правило для сервера, который ищет,
 * и клиента, который подсвечивает найденное.
 */
import { describe, expect, it } from "vitest";
import { searchFold, searchWords } from "./search.js";

describe("слова запроса", () => {
  it("нижний регистр, ё как е, разделители и знаки выбрасываются", () => {
    expect(searchWords("Ёлка, ДОГОВОР! deploy-2024")).toEqual([
      "елка",
      "договор",
      "deploy",
      "2024",
    ]);
  });

  it("слова короче двух знаков не ищутся: одна буква раскрылась бы во весь словарь", () => {
    expect(searchWords("а б в")).toEqual([]);
    expect(searchWords("я и ты")).toEqual(["ты"]);
  });

  it("повторы схлопываются, слов не больше восьми", () => {
    expect(searchWords("смета смета Смета")).toEqual(["смета"]);
    expect(searchWords("а1 б2 в3 г4 д5 е6 ж7 з8 и9 к10")).toHaveLength(8);
  });

  it("операторы поиска Postgres в слово не попадают", () => {
    expect(searchWords("договор & !срок | 'x':* <->")).toEqual(["договор", "срок"]);
  });

  it("подчёркивание делит слово так же, как разбор Postgres", () => {
    expect(searchWords("код_ошибки")).toEqual(["код", "ошибки"]);
  });
});

describe("нормализация", () => {
  it("ё как е и нижний регистр, длина строки не меняется", () => {
    expect(searchFold("ЁЛКА Ёж")).toBe("елка еж");
    expect(searchFold("ЁЛКА Ёж")).toHaveLength("ЁЛКА Ёж".length);
  });
});
