#!/usr/bin/env node

/**
 * Гейт: план с task-109 не идёт владельцу без второго прохода.
 * Правило и его причины — в `plan-review-rule.mjs`.
 *
 * Запуск: make plan-review
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FIRST, reviewProblems } from "./plan-review-rule.mjs";

const TASKS = "dock/tasks";

/**
 * Был ли файл в репозитории: есть сейчас или встречается в истории git.
 *
 * ⚠️ «ЕСТЬ СЕЙЧАС» — МАЛО. Сделанный план не переписывается, а файл, прочитанный
 * тогда, позже законно переезжает: 27.09 команда `delegate-review` стала скиллом
 * (task-126), и task-124 покраснел бы навсегда. Выдуманный путь истории не имеет —
 * он по-прежнему красный.
 */
function existed(path) {
  if (existsSync(path)) return true;
  const log = execFileSync("git", ["log", "--all", "--format=%h", "-1", "--", path], {
    encoding: "utf8",
  });
  return log.trim() !== "";
}

const plans = readdirSync(TASKS).filter((one) => one.startsWith("task-") && one.endsWith(".md"));
const found = plans.flatMap((name) =>
  reviewProblems(name, readFileSync(join(TASKS, name), "utf8"), existed).map((problem) => ({
    name,
    problem,
  })),
);

const checked = plans.filter((one) => Number(/^task-(\d+)/u.exec(one)?.[1] ?? 0) >= FIRST).length;
console.log(`планов ${plans.length}, в новом порядке (с task-${FIRST}) ${checked}`);

if (found.length > 0) {
  for (const { name, problem } of found) console.error(`  ${name}: ${problem}`);
  console.error(
    "\nПЛАН ОДОБРЕН БЕЗ ВТОРОГО ПРОХОДА.\n" +
      "  ПОЧИНИТЬ: верни статус «черновик», прогони `make trace-audit PLAN=task-NNN`\n" +
      "  и агента plan-critic, впиши ответ на каждое замечание в «Разбор критика»\n" +
      "  (принято / отвергнуто: причина), затем снова отдай владельцу.",
  );
  process.exit(1);
}

console.log("планы прошли второй проход — OK");
