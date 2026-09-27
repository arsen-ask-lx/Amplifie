import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mentionedIds, mentionMarkup } from "./mentions.js";

/**
 * Свойства упоминаний (task-121): не на придуманных примерах, а на тысячах
 * сочетаний имён и номеров. Падение печатает семя и сжатый пример.
 */
const RUNS = { numRuns: 200 };

/** Имя, как его может набрать человек: любые знаки, кроме пустоты по краям. */
const displayName = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((one) => one.trim() === one && one.length > 0);

describe("упоминания: свойства", () => {
  it("кого позвали — тот и найден, в нижнем регистре", () => {
    fc.assert(
      fc.property(displayName, fc.uuid(), (name, id) => {
        expect(mentionedIds(mentionMarkup(name, id))).toEqual([id.toLowerCase()]);
      }),
      RUNS,
    );
  });

  it("повторы и порядок не меняют, кого позвали", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(displayName, fc.uuid()), { maxLength: 6 }), (people) => {
        const body = people.map(([name, id]) => mentionMarkup(name, id)).join(" и ");
        const twice = `${body} ${[...people]
          .reverse()
          .map(([n, id]) => mentionMarkup(n, id))
          .join(" ")}`;
        // Ожидание — из входа, а не из mentionedIds: каждый номер один раз,
        // в нижнем регистре, в порядке первого упоминания.
        const expected: string[] = [];
        for (const [, id] of people) {
          const lower = id.toLowerCase();
          if (!expected.includes(lower)) expected.push(lower);
        }
        expect(mentionedIds(twice), "повторы схлопнуты").toEqual(expected);
        expect(mentionedIds(body), "первый вызов").toEqual(expected);
        expect(mentionedIds(body), "повторный вызов").toEqual(expected);
      }),
      RUNS,
    );
  });
});
