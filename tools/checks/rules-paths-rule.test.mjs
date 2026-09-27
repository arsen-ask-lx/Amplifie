/**
 * Подсадки сторожа правил по путям (task-126): мёртвый шаблон и несуществующий скилл краснеют.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pathsOf, problemsOf, skillsOf } from "./rules-paths-rule.mjs";

const files = ["backend/migrations/0001_x.sql", "backend/src/kernel/talk/schema.ts", "compose.yml"];
const skills = ["safe-migrations", "test-quality"];

const rule = (paths, body) =>
  `---\npaths:\n${paths.map((one) => `  - "${one}"`).join("\n")}\n---\n\n${body}\n`;

describe("разбор правила", () => {
  it("шаблоны из frontmatter", () => {
    assert.deepEqual(pathsOf(rule(["backend/migrations/**", "compose*.yml"], "x")), [
      "backend/migrations/**",
      "compose*.yml",
    ]);
  });

  it("скиллы — по форме имени, команды и файлы — нет", () => {
    const body = "Загрузи `safe-migrations`; проверяет `make cost`, файл `compose.dev.yml`.";
    assert.deepEqual(skillsOf(body), ["safe-migrations"]);
  });
});

describe("живое правило — без замечаний", () => {
  it("шаблон находит файл, скилл есть", () => {
    const text = rule(["backend/migrations/**"], "Сначала скилл `safe-migrations`.");
    assert.deepEqual(problemsOf(text, files, skills), []);
  });
});

describe("мёртвое правило — замечание", () => {
  it("шаблон в никуда", () => {
    const text = rule(["backend/src/migrations/**"], "Сначала скилл `safe-migrations`.");
    assert.deepEqual(problemsOf(text, files, skills), [
      "шаблон «backend/src/migrations/**» не находит ни одного файла",
    ]);
  });

  it("скилла нет", () => {
    const text = rule(["compose*.yml"], "Сначала скилл `docker-compose-pattern`.");
    assert.deepEqual(problemsOf(text, files, skills), [
      "скилла «docker-compose-pattern» нет в .claude/skills",
    ]);
  });

  it("без paths правило грузится всегда — это не правило по файлам", () => {
    assert.deepEqual(problemsOf("# правило\n\n`test-quality`\n", files, skills), [
      "нет `paths:` — правило грузится всегда, а не по файлам",
    ]);
  });

  it("скилл не назван", () => {
    assert.deepEqual(problemsOf(rule(["compose*.yml"], "Просто текст."), files, skills), [
      "не названо ни одного скилла",
    ]);
  });
});
