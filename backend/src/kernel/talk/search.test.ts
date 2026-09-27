/**
 * Правило упоминания в миграции поиска — то же, что в общем пакете (task-100).
 * Слова запроса проверяются у самого правила: `packages/contract/src/search.test.ts`.
 *
 * ⚠️ СВЕРЯЕТСЯ ПОСЛЕДНЯЯ МИГРАЦИЯ, ЧТО ОПРЕДЕЛЯЕТ `search_text`, а не 0027 навсегда:
 * правило менялось (0030, task-121), и действует последнее определение.
 */
import { readdirSync, readFileSync } from "node:fs";
import { MENTION_SOURCE } from "@amplifie/contract";
import { describe, expect, it } from "vitest";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

function lastSearchText(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, MIGRATIONS), "utf8"))
    .filter((sql) => /FUNCTION search_text\(/u.test(sql));
  const last = defining.at(-1);
  if (!last) throw new Error("ни одна миграция не определяет search_text");
  return last;
}

describe("упоминание в SQL и в общем пакете — одно правило", () => {
  it("последняя миграция вычищает упоминание тем же выражением, что `MENTION_SOURCE`", () => {
    expect(lastSearchText()).toContain(`'${MENTION_SOURCE}'`);
  });
});
