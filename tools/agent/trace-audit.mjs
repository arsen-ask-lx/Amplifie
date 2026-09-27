#!/usr/bin/env node
/**
 * Сверка плана с делом по записи сессии агента (task-109).
 *
 * Запуск: make trace-audit PLAN=task-108 [SESSION=путь/к/сессии.jsonl]
 *
 * Без SESSION берётся самая свежая запись Claude Code этого проекта
 * (`~/.claude/projects/<проект>/`). Правила — в `trace-rules.mjs`.
 *
 * ⚠️ ТОЛЬКО ЧТЕНИЕ И ТОЛЬКО ЗДЕСЬ. В записи лежат выводы команд — всё,
 * что агент видел. Наружу из этого файла не уходит ничего, а печатается
 * только путь, число строк и вердикт.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { latestSession, records, sessionsDir } from "./session-log.mjs";
import { claimsIn, claimTime, coverageOf, criticRan, readsFrom, verdict } from "./trace-rules.mjs";

const TASKS = "dock/tasks";

/**
 * Сколько часов до заявления чтение ещё считается чтением этого файла.
 *
 * ⚠️ СУТКИ — НЕ ВЫВЕДЕННОЕ ЧИСЛО, А ГРАНИЦА ЗДРАВОГО СМЫСЛА. Без окна
 * `talk/service.ts` засчитывался «целиком» из сорока трёх кусков за две
 * недели (21.09). План обычно пишется в тот же рабочий день, что и чтение.
 */
const FRESH_HOURS = Number(process.env.FRESH_HOURS ?? 24);

function fail(message) {
  console.error(message);
  process.exit(2);
}

function planPath(name) {
  const found = readdirSync(TASKS).find(
    (one) => one.startsWith(`${name}-`) || one === `${name}.md`,
  );
  if (!found)
    fail(
      `нет плана ${name} в ${TASKS}\n  ПОЧИНИТЬ: PLAN=task-108 — номер плана, как в имени файла`,
    );
  return join(TASKS, found);
}

/** Сколько строк в файле репозитория сейчас — для команд оболочки. */
function linesOf(path) {
  try {
    return readFileSync(path, "utf8").split("\n").length - 1 || 1;
  } catch {
    return null;
  }
}

const plan = process.env.PLAN ?? process.argv[2];
if (!plan) fail("нужен PLAN, например: make trace-audit PLAN=task-108");

const planFile = planPath(plan);
const session = process.env.SESSION ?? latestSession();
if (!session) fail(`в ${sessionsDir()} нет записей сессий`);
const all = await records(session);
const until = claimTime(all, plan);
/**
 * ⚠️ БЕЗ МОМЕНТА ЗАЯВЛЕНИЯ ОТВЕТА НЕТ (разбор критика 21.09). Самой свежей
 * бывает чужая запись — рядом работает второй агент, — и сверка по ней
 * засчитала бы автору чужие чтения и ответила зелёным.
 */
if (until === null) {
  fail(
    `в записи ${basename(session)} план ${plan} не писался — сверять не с чем.\n` +
      "  ПОЧИНИТЬ: укажи запись, где план писался: SESSION=путь/к/сессии.jsonl",
  );
}
const claims = claimsIn(readFileSync(planFile, "utf8"));
const since = until - FRESH_HOURS * 3_600_000;
// Путь есть в репозитории — засчитывается он, а не одноимённый вложенный (Д-67).
const isFile = (path) => existsSync(path) && statSync(path).isFile();
const rows = verdict(claims, coverageOf(readsFrom(all, until, since), linesOf), isFile);

console.log(`план: ${planFile}`);
console.log(`запись: ${basename(session)} — событий с инструментами ${all.length}`);
console.log(
  `сверка с тем, что было открыто за ${FRESH_HOURS} ч до ${new Date(until).toISOString()}`,
);
console.log("");
/** Сколько часов прошло от последнего чтения до заявления — давнее видно сразу. */
const age = (lastAt) =>
  until && lastAt
    ? `, прочитан за ${((until - lastAt) / 3_600_000).toFixed(1)} ч до заявления`
    : "";

for (const row of rows) {
  const amount = row.total ? ` — ${row.seen} из ${row.total} строк` : "";
  const where = row.path && row.path !== row.file ? ` [${row.path}]` : "";
  console.log(
    `${row.status === "целиком" ? "✔" : "✘"} ${row.file}: ${row.status}${amount}${age(row.lastAt)}${where}`,
  );
}

const critic = criticRan(all, plan, until);
console.log(
  `\n${critic ? "✔" : "✘"} критика plan-critic по этому плану ${critic ? "звали" : "не звали"}`,
);

const wrong = rows.filter((one) => one.status !== "целиком");
console.log(`\nзаявлено целиком ${rows.length}, подтверждено ${rows.length - wrong.length}`);
if (rows.length === 0) {
  console.log("заявлений «прочитано целиком» в плане нет — сверять нечего");
}
if (wrong.length > 0) {
  console.error(
    "\nЗАЯВЛЕНО, НО НЕ СДЕЛАНО.\n" +
      "  ПОЧИНИТЬ: прочитай эти файлы целиком — или честно пометь в таблице\n" +
      "  «Прочитано» как «фрагмент (строки)». Пересказ подагента чтением не считается.",
  );
  process.exit(1);
}
if (!critic) {
  console.error(
    "\nКРИТИКА НЕ БЫЛО.\n" +
      "  ПОЧИНИТЬ: позови агента plan-critic с номером плана — строка «Замечаний нет»,\n" +
      "  написанная автором, разбора не заменяет.",
  );
  process.exit(1);
}
