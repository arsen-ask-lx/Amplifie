import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const checker = resolve("tools/checks/check-decisions.mjs");
const fixtures = resolve("tmp/decisions-tests");
mkdirSync(fixtures, { recursive: true });
const valid = (n) =>
  `<a id="r-${n}"></a>\n\n### Р-${n} — пример\n\n## Источники\n\n` +
  "[Postgres](https://www.postgresql.org/docs/)\n[Node](https://nodejs.org/docs/)\n";

function run(text) {
  const cwd = mkdtempSync(`${fixtures}/case-`);
  mkdirSync(`${cwd}/dock`);
  if (text !== null) writeFileSync(`${cwd}/dock/decisions.md`, text);
  return spawnSync(process.execPath, [checker], { cwd, encoding: "utf8" });
}

test("единый файл с решениями и источниками действительно прочитан", () => {
  const result = run(valid("001"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /решения: 1/u);
});

test("пустой, отсутствующий или лишённый источников реестр красный", () => {
  for (const text of [null, "# Решения\n", '<a id="r-001"></a>\n### Р-001 — без оснований\n']) {
    assert.equal(run(text).status, 1);
  }
});

test("источники соседнего решения не оправдывают решение без источников", () => {
  assert.equal(run(`${valid("001")}<a id="r-002"></a>\n### Р-002 — пусто\n`).status, 1);
});

test("два решения с одним номером не проходят", () => {
  assert.equal(run(valid("001") + valid("001")).status, 1);
});

test("одна внешняя ссылка и ссылка на localhost не заменяют два источника", () => {
  assert.equal(
    run(valid("001").replace("https://nodejs.org/docs/", "http://localhost/docs")).status,
    1,
  );
});
