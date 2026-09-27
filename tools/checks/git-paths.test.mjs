/**
 * Гейты, читающие пути из git, не зависят от `core.quotePath` машины.
 *
 * ⚠️ ПОДСАДКА — НАСТРОЙКА КОНВЕЙЕРА, А НЕ ВЫДУМКА. В Linux по умолчанию
 * `core.quotePath=true`: русское имя приходит как `"dock/tasks/task-121-\320\277…"`.
 * У владельца в Windows она выключена глобально, и 27.09 `make cycle` был зелёным
 * локально, а в CI красным на пяти коммитах с русскими именами планов. Гейт карты
 * в тех же условиях молча находил на один повод меньше.
 *
 * ⚠️ СВОЙ РЕПОЗИТОРИЙ, А НЕ НАШ. Гейт карты смотрит только последний коммит: на
 * истории проекта тест доказывал бы что-то, лишь пока в HEAD есть русский путь.
 * Здесь он есть всегда, и ответ известен заранее — «оба прогона одинаково упали»
 * за зелёный не сойдёт.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

import { parseChanges } from "./git-changes.mjs";

const CHECKS = resolve(import.meta.dirname);
const PLAN = "dock/tasks/task-1-русское-имя.md";

let repo;

function run(command, args, env = {}) {
  const done = spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: done.status, out: `${done.stdout}${done.stderr}` };
}

function commit(files, message) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  const git = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
  assert.equal(run("git", ["add", "-A"]).status, 0);
  assert.equal(run("git", [...git, "commit", "-q", "--no-verify", "-m", message]).status, 0);
}

/** Гейт в фикстуре; настройка ДОПИСЫВАЕТСЯ к уже заданным `git -c`, а не затирает их. */
function gate(script, quotePath) {
  const inherited = process.env.GIT_CONFIG_PARAMETERS ?? "";
  return run(process.execPath, [join(CHECKS, script)], {
    GIT_CONFIG_PARAMETERS: `${inherited} 'core.quotepath=${quotePath}'`.trim(),
  });
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "git-paths-"));
  run("git", ["init", "-q"]);
  commit({ "README.md": "до правила\n" }, "chore: начало");
  commit(
    {
      "tools/checks/cycle-rule.mjs": "// правило цикла появилось здесь\n",
      [PLAN]: "# task-1\n\nСтатус: одобрен\n",
      "dock/README.md": "# карта\n",
      "backend/src/x.ts": "export const x = 1;\n",
      "backend/src/x.test.ts": "// проверка x\n",
    },
    [
      "feat(x): новое",
      "",
      "план: task-1",
      "тест: backend/src/x.test.ts",
      "спека: не требуется — поведение наружу не видно",
      "ревью: ocr — замечаний 0, принято 0",
      "карта: dock/README.md — план task-1",
      "",
      "Сделано: x.",
      "Не уверен: ничего.",
    ].join("\n"),
  );
});

after(() => rmSync(repo, { recursive: true, force: true }));

describe("разбор `--name-status -z`", () => {
  it("у переименования и копии берётся новый путь, имя с табуляцией целое", () => {
    const raw = ["M", "a\tb.md", "R100", "старое.md", "новое.md", "C75", "x", "y", "D", "z", ""];
    assert.deepEqual(parseChanges(raw.join("\0")), [
      { status: "M", path: "a\tb.md" },
      { status: "R", path: "новое.md" },
      { status: "C", path: "y" },
      { status: "D", path: "z" },
    ]);
  });
});

describe("гейты читают русские имена одинаково на любой машине", () => {
  for (const quotePath of ["true", "false"]) {
    it(`цикл находит план с русским именем (quotepath=${quotePath})`, () => {
      const got = gate("check-cycle.mjs", quotePath);
      assert.equal(got.status, 0, got.out);
      assert.match(got.out, /коммитов 1, с кодом 1 — OK/u);
    });

    it(`карта считает повод с русским именем (quotepath=${quotePath})`, () => {
      const got = gate("check-map.mjs", quotePath);
      assert.equal(got.status, 0, got.out);
      assert.match(got.out, /поводов 1/u);
    });
  }
});
