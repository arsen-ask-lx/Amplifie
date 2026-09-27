#!/usr/bin/env node
/**
 * Было ли ревью по-настоящему — перед коммитом, по записи сессии агента (task-124).
 *
 * Запуск: хук `commit-msg` — `node tools/agent/review-audit.mjs <файл-сообщения>`.
 *
 * Сторож цикла проверяет форму: строка «ревью: ocr», отчёт в коммите, все файлы названы.
 * Кто и как написал отчёт, форма не говорит — 27.09 строка стояла в коммитах, где шаг
 * правил `ocr` не выполнялся. Здесь — факт: с прошлого коммита агент просил у `ocr`
 * правила по каждому файлу продукта и поставки и после этого звал агента `reviewer`.
 *
 * ⚠️ КОММИТ АГЕНТА УЗНАЁТСЯ ПО ОКРУЖЕНИЮ, А НЕ ПО ТЕКСТУ. Claude Code ставит своим
 * командам `CLAUDECODE=1`, и хук git наследует его. Строку соавторства в сообщении агент
 * может просто не написать — и сверка выключилась бы одним пропуском (второй разбор).
 *
 * ⚠️ ТОЛЬКО ЛОКАЛЬНО. CI записи сессии не видит — там остаётся проверка формы.
 */
import { readFileSync } from "node:fs";

import { kindOf, messageOf } from "../checks/cycle-rule.mjs";
import { NAME_STATUS, parseChanges } from "../checks/git-changes.mjs";
import { commitBase, git } from "../checks/git-commit.mjs";
import { records, sessionOfCommit } from "./session-log.mjs";
import { reviewRan } from "./trace-rules.mjs";

function fail(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

if (process.env.CLAUDECODE !== "1") process.exit(0); // коммит человека
const message = messageOf(readFileSync(process.argv[2] ?? "", "utf8"));
if (!/^\s*ревью\s*:\s*ocr/imu.test(message)) process.exit(0);

// Дописывая коммит, сравниваем с его родителем, и ревью ищем с момента родителя.
const base = commitBase();
// Те же файлы, что считает сторож цикла: переименование — по новому пути (`-M`),
// удалённый продукт не в счёт, удалённая поставка — в счёт (ревью task-124).
const code = parseChanges(git("diff", "--cached", ...NAME_STATUS, "-M", base).out)
  .filter((one) => {
    const kind = kindOf(one.path, true);
    return kind === "delivery" || (kind === "product" && one.status !== "D");
  })
  .map((one) => one.path);
if (code.length === 0) process.exit(0);

const session = sessionOfCommit();
if (!session) {
  fail([
    "ревью: не нашлась запись сессии, которая делает этот коммит — сверять не с чем.",
    "  Коммит идёт из Claude Code (CLAUDECODE=1), значит запись должна быть свежей.",
  ]);
}
const since = Number(git("log", "-1", "--format=%ct", base).out) * 1000 || null;
const { rules, subagent } = reviewRan(await records(session), code, since);

if (!rules) {
  fail([
    "ревью: с прошлого коммита правила `ocr` по этим файлам не запрашивались.",
    `  файлы: ${code.join(", ")}`,
    "  ПОЧИНИТЬ: /delegate-review целиком — `ocr delegate rule <все файлы>`, затем ревью",
    "  подагентом и отчёт в dock/reviews/. Строка «ревью: ocr» без этого — неправда.",
  ]);
}
if (!subagent) {
  fail([
    "ревью: правила `ocr` запрошены, но агента `reviewer` после них не звали.",
    "  ПОЧИНИТЬ: Agent с subagent_type «reviewer» (`.claude/agents/reviewer.md`, task-126);",
    "  в задании — и слово «ревью», и пути файлов. Другой подагент не засчитывается.",
  ]);
}
console.log(`ревью: правила ocr по ${code.length} файлам и подагент — по записи сессии — OK`);
