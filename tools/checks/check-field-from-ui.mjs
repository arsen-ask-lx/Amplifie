#!/usr/bin/env node
/**
 * Поле в интерфейсе — только из общего набора (task-105).
 *
 * ЗАЧЕМ. Владелец 17.09: «я думал у нас 1 тип поля и мы его переиспользуем
 * или не так?». Так — почти: поля формы жили в `shared/ui/input.tsx`, а окно
 * поиска рисовало своё, мимо набора. Разница видна не автору правки,
 * а человеку, который открыл два окна подряд.
 *
 * ЧТО ПРОВЕРЯЕТ. Ни одного сырого `<input>`, `<select>` и `<textarea>`
 * в разметке интерфейса вне `shared/ui` — там они и живут по определению:
 * это и есть набор. Компонент набора можно завести новый, нельзя завести
 * поле МИМО набора.
 *
 * ЧЕГО НЕ ЛОВИТ. Копию стилей поля на `div` с `contentEditable` — такое
 * у нас одно, редактор реплики, и он не поле браузера. И вид: что поле
 * набора выглядит как задумано, проверяет `make contrast` и глаз владельца.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";

const ROOT = "frontend/src";
/** Набор — единственное законное место сырых полей. */
const UI = posix.join(ROOT, "shared/ui");
const TAGS = /<(input|select|textarea)[\s/>]/;

/** Все файлы разметки под корнем интерфейса. */
function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (name.endsWith(".tsx")) out.push(path.split(sep).join("/"));
  }
  return out;
}

/**
 * Строки без комментариев: упоминание `<select>` в объяснении «почему
 * компонент набора, а не голый список» — не нарушение, а причина правила.
 */
function codeLines(text) {
  const lines = [];
  let inBlock = false;
  for (const [at, raw] of text.split("\n").entries()) {
    const step = commentStep(raw.trim(), inBlock);
    inBlock = step.inBlock;
    if (!step.comment) lines.push([at + 1, raw]);
  }
  return lines;
}

/**
 * Строка — комментарий или код, и открыт ли после неё блочный комментарий.
 * Вынесено из `codeLines` ради предела сложности линтера (Д-64), поведение прежнее.
 */
function commentStep(line, inBlock) {
  if (inBlock) return { comment: true, inBlock: !line.includes("*/") };
  if (line.startsWith("/*")) return { comment: true, inBlock: !line.includes("*/") };
  const comment = line.startsWith("*") || line.startsWith("//") || line.startsWith("{/*");
  return { comment, inBlock: false };
}

const problems = [];
let checked = 0;

for (const file of filesIn(ROOT)) {
  if (file.startsWith(`${UI}/`)) continue;
  checked += 1;
  for (const [at, line] of codeLines(readFileSync(file, "utf8"))) {
    if (TAGS.test(line)) problems.push(`${file}:${at}: ${line.trim().slice(0, 80)}`);
  }
}

if (problems.length > 0) {
  console.error(`\nПоля мимо общего набора: ${problems.length}\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\n  ПОЧИНИТЬ: возьми компонент из frontend/src/shared/ui или заведи там новый.");
  console.error("  Своё поле выглядит как чужое в соседнем окне — это видит не автор, а человек.");
  process.exit(1);
}

console.log(`поля: ${checked} файлов разметки вне набора — сырых полей нет`);
