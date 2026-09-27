/**
 * Подсадки правил Biome, которые держат стандарт тестов (task-125).
 *
 * ⚠️ ПРАВИЛО ИЗ ГРУППЫ `nursery`: в минорной версии его могут переименовать или
 * убрать, и тогда конфиг молча перестанет сторожить. Эта проверка — положительный
 * контроль: сон в спеке обязан краснеть, спека без сна — нет.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const biome = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

/**
 * Линтер над текстом, положенным файлом по этому пути: действуют переопределения конфига.
 *
 * ⚠️ ВО ВРЕМЕННОЙ ПАПКЕ С КОПИЕЙ НАШЕГО biome.json, А НЕ В ДЕРЕВЕ: образец со сном
 * в `frontend/tests` покрасил бы `make lint`, идущий рядом. И не через
 * `--stdin-file-path`: в 2.5.14 он отвечает «The contents aren't fixed» кодом 1
 * на любой текст, и правило там не видно.
 */
function lint(path, code) {
  const root = mkdtempSync(join(tmpdir(), "biome-rules-"));
  try {
    copyFileSync("biome.json", join(root, "biome.json"));
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), code);
    // Во временной папке нет git, а конфиг читает `.gitignore` и без него не стартует.
    const run = spawnSync(process.execPath, [biome, "lint", "--vcs-enabled=false", path], {
      cwd: root,
      encoding: "utf8",
    });
    return { status: run.status, said: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

const SPEC = "frontend/tests/ui/sample.spec.ts";
const slept = `export async function wait(page) {\n  await page.waitForTimeout(1000);\n}\n`;
const signalled = `export async function wait(page) {\n  await page.getByText("готово").waitFor();\n}\n`;

describe("слепой сон в браузерной спеке", () => {
  it("краснеет", () => {
    const { status, said } = lint(SPEC, slept);
    assert.equal(status, 1);
    assert.match(said, /noPlaywrightWaitForTimeout/u);
  });

  it("ожидание признака — не краснеет", () => {
    assert.deepEqual(lint(SPEC, signalled).status, 0);
  });
});
