import { searchFold, searchWords } from "@amplifie/contract";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { marksIn } from "./searchLine.js";

/**
 * Свойства подсветки найденного (task-121). Склейка кусков в исходную строку
 * верна всегда — срезы идут подряд, — поэтому сдвиг подсветки ловит другое
 * свойство: подсвечен ровно кусок, который после нормализации и есть слово
 * запроса (критик плана task-121).
 */
const RUNS = { numRuns: 300 };

/** Буквы, на которых нормализация ведёт себя по-разному: ё, заглавные, турецкая İ. */
const letter = fc.constantFrom(..."абвгдеёжзАБЁЯabcdeXYZİıßΣς12");
const word = fc.string({ unit: letter, minLength: 1, maxLength: 6 });
const gap = fc.constantFrom(" ", ", ", " — ", ".");

/**
 * Строка из слов и запрос из её же слов: случайная строка против случайного
 * запроса почти никогда не совпадает, и свойство молча проходило мимо «İ ab».
 */
const lineAndQuery = fc.array(fc.tuple(word, gap), { minLength: 1, maxLength: 8 }).chain((parts) =>
  fc.tuple(
    fc.constant(parts.map(([one, sep]) => one + sep).join("")),
    fc.subarray(parts.map(([one]) => one)).map((picked) => picked.join(" ")),
  ),
);

describe("подсветка найденного: свойства", () => {
  it("куски складываются в исходную строку", () => {
    fc.assert(
      fc.property(lineAndQuery, ([line, query]) => {
        const marks = marksIn(line, searchWords(query));
        expect(marks.map((one) => one.text).join("")).toBe(line);
      }),
      RUNS,
    );
  });

  it("подсвечен ровно кусок, который и есть слово запроса", () => {
    fc.assert(
      fc.property(lineAndQuery, ([line, query]) => {
        const words = searchWords(query);
        for (const mark of marksIn(line, words)) {
          if (mark.hit) expect(words).toContain(searchFold(mark.text));
        }
      }),
      RUNS,
    );
  });
});
