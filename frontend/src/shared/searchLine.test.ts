/**
 * Строка найденного сообщения (task-100): как тело с разметкой становится
 * одной строкой выдачи и что в ней подсвечено. Без браузера — чистые функции.
 */
import { describe, expect, it } from "vitest";
import { lineOf, marksIn, snippetAround } from "./searchLine.js";

const hits = (text: string, words: string[]) =>
  marksIn(text, words)
    .filter((one) => one.hit)
    .map((one) => one.text);

describe("строка сообщения", () => {
  it("разметка уходит, упоминание — с собакой, ссылка — подписью", () => {
    expect(
      lineOf(
        "**срочно** [Анна](@3fa85f64-5717-4562-b3fc-2c963f66afa6), см. [смету](https://a.b/c) `код`",
      ),
    ).toBe("срочно @Анна, см. смету код");
  });

  it("переводы строк и блок кода — в одну строку", () => {
    expect(lineOf("первая\nвторая\n```\nselect 1\n```")).toBe("первая вторая select 1");
  });
});

describe("кусок вокруг совпадения", () => {
  it("короткая строка остаётся целиком", () => {
    expect(snippetAround("договор подписан", ["договор"], 80)).toBe("договор подписан");
  });

  it("длинная режется так, чтобы найденное было видно, с многоточиями", () => {
    const long = `${"слово ".repeat(40)}договор подписан ${"хвост ".repeat(40)}`.trim();
    const piece = snippetAround(long, ["договор"], 60);
    expect(piece).toContain("договор");
    expect(piece.startsWith("…")).toBe(true);
    expect(piece.endsWith("…")).toBe(true);
    expect(piece.length).toBeLessThanOrEqual(62);
  });
});

describe("подсветка", () => {
  it("по началу слова, без учёта регистра и ё", () => {
    expect(hits("Договоры и договора на Ёлке", ["договор", "елк"])).toEqual([
      "Договор",
      "договор",
      "Ёлк",
    ]);
  });

  it("не подсвечивает середину слова — её поиск и не находит", () => {
    expect(hits("переговоры", ["говор"])).toEqual([]);
  });

  it("без слов — один кусок без подсветки", () => {
    expect(marksIn("текст", [])).toEqual([{ text: "текст", hit: false }]);
  });
});
