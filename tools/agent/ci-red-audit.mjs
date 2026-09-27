#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * Сторож «CI красный — сначала причина» (`AGENTS.md`) — на коммите, а не на
 * каждой правке (task-126, п. 3 «Как делаем»). Подключается хуком `commit-msg`
 * рядом с `review-audit.mjs`; сам файл `.githooks/commit-msg` — вне этой задачи.
 *
 * Запуск: `node tools/agent/ci-red-audit.mjs`.
 *
 * Ход: ветка (`git rev-parse --abbrev-ref HEAD`) → последний прогон CI этой ветки
 * с исходом `success` или `failure` (отменённые пропускаются) → не `failure` —
 * пропуск; `failure` — журнал упавшего (`gh run view --log-failed`), упавшие
 * по `ci-red-rules.mjs`, неизвестные против `tools/ratchets/ci-known-red.txt` →
 * пусто — пропуск; иначе нужен полный `dock/ci/<прогон>.md` — есть и полон —
 * пропуск, иначе отказ с прогоном, неизвестными, путём файла и подсказкой.
 *
 * ⚠️ FAIL-OPEN БЕЗ `gh`, СЕТИ ИЛИ ПРИ ТАЙМАУТЕ (30 с на команду CLI) — НАЗВАНО
 * ВСЛУХ, А НЕ ЗАБЫТО. Без этого нельзя было бы закоммитить вовсе, пока нет
 * сети или `gh` не стоит (разбор критика плана, п. 3): цена пропуска ниже
 * цены запертой работы. Каждый пропуск печатается и пишется строкой в
 * `tmp/agent/hook-errors.log` — там же, где пропуски хука чтения. 30 с, а не 10:
 * на этой машине `gh run view --log-failed` отвечал за 1,5–19 с при живой сети
 * (ревью task-126), и 10 с пропускали сверку в обычный день.
 *
 * ⚠️ И ДЛЯ КОММИТА ЧЕЛОВЕКА, в отличие от `review-audit.mjs`. Тот сверяет запись
 * сессии агента — у человека её нет. Правило «красное — сначала причина» общее,
 * и красный CI не становится безопаснее, если коммит сделан руками.
 *
 * ⚠️ БИТЫЙ ХРАПОВИК — НЕ FAIL-OPEN. Строка без `Д-NN` в
 * `tools/ratchets/ci-known-red.txt` — наша собственная ошибка, не сетевая:
 * она отклоняет коммит, а не пропускает его молча.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";

import {
  analysisComplete,
  analysisMissing,
  parseFailedLog,
  parseKnownRed,
  unknownFailures,
} from "./ci-red-rules.mjs";

const TIMEOUT_MS = 30_000;
const RATCHET_PATH = "tools/ratchets/ci-known-red.txt";
const SKIPS_LOG = "tmp/agent/hook-errors.log";

function skip(message) {
  console.log(`CI: не проверено — ${message}`);
  try {
    mkdirSync("tmp/agent", { recursive: true });
    appendFileSync(SKIPS_LOG, `${new Date().toISOString()} ci-red: ${message}\n`);
  } catch (error) {
    console.log(`CI: пропуск не записан в ${SKIPS_LOG} — ${error.message}`);
  }
  process.exit(0);
}

function fail(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

/** Внешняя команда с таймаутом; исход — либо строка вывода, либо причина неудачи. */
function run(cmd, args) {
  try {
    return { out: execFileSync(cmd, args, { encoding: "utf8", timeout: TIMEOUT_MS }) };
  } catch (error) {
    if (error.signal === "SIGTERM") return { error: `${cmd} не ответил за ${TIMEOUT_MS / 1000} с` };
    if (error.code === "ENOENT") return { error: `${cmd} не найден` };
    return {
      error: `${cmd} упал: ${(error.stderr || error.message || "").toString().trim().slice(0, 200)}`,
    };
  }
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch.error) skip(branch.error); // без ветки (detached HEAD и т. п.) сверять нечего

const list = run("gh", [
  "run",
  "list",
  "--branch",
  branch.out.trim(),
  "--status",
  "completed",
  "--limit",
  "20",
  "--json",
  "databaseId,conclusion,headSha",
]);
if (list.error) skip(list.error);

let runs;
try {
  runs = JSON.parse(list.out);
} catch {
  skip("gh run list вернул не JSON");
}
/**
 * ⚠️ ОТМЕНЁННЫЙ ПРОГОН — НЕ ОТВЕТ. Пуш отменяет идущий CI (task-123), и последний
 * завершённый прогон ветки почти всегда «cancelled»: брали бы его — красное перед ним
 * не видели бы никогда. Берём последний с настоящим исходом.
 */
const last = runs.find((one) => one.conclusion === "success" || one.conclusion === "failure");
if (last?.conclusion !== "failure") process.exit(0); // нет прогона с исходом или он зелёный

const log = run("gh", ["run", "view", String(last.databaseId), "--log-failed"]);
if (log.error) skip(log.error);

const failures = parseFailedLog(log.out);
// Красный, а разбор не нашёл упавшего: формат журнала нов или упала инфраструктура.
// Пропускаем, но вслух — молча это был бы тихий отказ самого сторожа.
if (failures.length === 0)
  skip(`прогон ${last.databaseId} красный, но упавшее в журнале не разобрано`);

let ratchetText;
try {
  ratchetText = readFileSync(RATCHET_PATH, "utf8");
} catch {
  ratchetText = "";
}
const { known, errors } = parseKnownRed(ratchetText);
if (errors.length > 0) {
  fail([
    `CI: храповик ${RATCHET_PATH} сломан — не строка «ключ | Д-NN»:`,
    ...errors.map((one) => `  ${one}`),
  ]);
}

const unknown = unknownFailures(failures, known);
if (unknown.length === 0) {
  console.log("CI: красное только известное — OK");
  process.exit(0);
}

const analysisPath = `dock/ci/${last.databaseId}.md`;
let analysis = null;
try {
  analysis = readFileSync(analysisPath, "utf8");
} catch {
  analysis = null;
}
const missing = analysis ? analysisMissing(analysis, unknown) : unknown;
if (analysis && analysisComplete(analysis) && missing.length === 0) process.exit(0);

fail([
  `CI: прогон ${last.databaseId} (ветка ${branch.out.trim()}) красный на неизвестном:`,
  ...unknown.map((one) => `  - ${one}`),
  analysis
    ? `  файл разбора ${analysisPath} неполон: четыре раздела с текстом и каждое упавшее выше дословно${missing.length > 0 ? ` (не названо: ${missing.length})` : ""}:`
    : `  ПОЧИНИТЬ: заведи ${analysisPath} с четырьмя разделами и каждым упавшим выше дословно:`,
  "    ## Текст падения / ## Класс (продукт·тест·окружение·инструмент) / ## Причина / ## Что уже описано",
  `  или, если решаем не чинить сейчас, — строку в ${RATCHET_PATH}:`,
  `    ${unknown[0]} | Д-NN`,
]);
