import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const checker = resolve("tools/checks/check-decisions.mjs");
const fixtures = resolve("tmp/decisions-tests");
mkdirSync(fixtures, { recursive: true });
const valid = (n) =>
  `<a id="r-${n}"></a>\n\n### Р-${n} — пример\n\n## Источники\n\n` +
  "[Postgres](https://www.postgresql.org/docs/)\n[Node](https://nodejs.org/docs/)\n";

/** Прогон проверки в своей папке; папка убирается сразу — за тестом не остаётся следа. */
function run(text) {
  const cwd = mkdtempSync(`${fixtures}/case-`);
  try {
    mkdirSync(`${cwd}/dock`);
    if (text !== null) writeFileSync(`${cwd}/dock/decisions.md`, text);
    // Без NODE_OPTIONS: предупреждение рантайма в stderr сломало бы точную сверку находки.
    const env = { ...process.env, NODE_OPTIONS: "" };
    return spawnSync(process.execPath, [checker], { cwd, encoding: "utf8", env });
  } finally {
    // Повторы — на Windows только что записанный файл бывает занят антивирусом.
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Красное — по тексту находки, а не только по коду: упавший с исключением скрипт
 * тоже выходит с 1, и тест по одному коду принял бы поломку за отказ по делу.
 */
function assertRejected(result, problem, summary) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, `dock/decisions.md: ${problem}\n`);
  assert.equal(result.stdout, summary === null ? "" : `${summary}\n`);
}

test("единый файл с решениями и источниками действительно прочитан", () => {
  const result = run(valid("001"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "решения: 1, ошибок: 0\n");
});

test("отсутствующий реестр красный", () => {
  assertRejected(
    run(null),
    "реестр отсутствует; восстанови файл, пустота не является успехом",
    null,
  );
});

test("реестр без единого решения красный", () => {
  assertRejected(
    run("# Решения\n"),
    "нет ни одного решения с якорем r-NNN",
    "решения: 0, ошибок: 1",
  );
});

test("решение без раздела источников красное", () => {
  assertRejected(
    run('<a id="r-001"></a>\n### Р-001 — без оснований\n'),
    "Р-001: нет собственного раздела «Источники»",
    "решения: 1, ошибок: 1",
  );
});

test("источники соседнего решения не оправдывают решение без источников", () => {
  assertRejected(
    run(`${valid("001")}<a id="r-002"></a>\n### Р-002 — пусто\n`),
    "Р-002: нет собственного раздела «Источники»",
    "решения: 2, ошибок: 1",
  );
});

test("два решения с одним номером не проходят", () => {
  assertRejected(
    run(valid("001") + valid("001")),
    "Р-001: номер занят дважды",
    "решения: 2, ошибок: 1",
  );
});

test("одна внешняя ссылка и ссылка на localhost не заменяют два источника", () => {
  assertRejected(
    run(valid("001").replace("https://nodejs.org/docs/", "http://localhost/docs")),
    "Р-001: внешних источников 1, нужно минимум 2",
    "решения: 1, ошибок: 1",
  );
});
