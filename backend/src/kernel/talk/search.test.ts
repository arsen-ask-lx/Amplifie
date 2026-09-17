/**
 * Правило упоминания в миграции поиска — то же, что в общем пакете (task-100).
 * Слова запроса проверяются у самого правила: `packages/contract/src/search.test.ts`.
 */
import { readFileSync } from "node:fs";
import { MENTION_SOURCE } from "@amplifie/contract";
import { describe, expect, it } from "vitest";

describe("упоминание в SQL и в общем пакете — одно правило", () => {
  it("миграция вычищает упоминание тем же выражением, что `MENTION_SOURCE`", () => {
    const migration = readFileSync(
      new URL("../../../migrations/0027_message_search.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(`'${MENTION_SOURCE}'`);
  });
});
