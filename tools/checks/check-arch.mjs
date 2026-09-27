#!/usr/bin/env node
/**
 * Границы модулей — обход репозитория без компилятора (Р-047).
 *
 * ЗАЧЕМ СВОЙ. dependency-cruiser читает TypeScript через API компилятора,
 * которого у TypeScript 7 нет до 7.1. Дважды (07.09 и 26.09) он обходил
 * ноль модулей и печатал «no dependency violations found» с кодом 0 —
 * сторож ослеп и рапортовал «чисто». Правила и их подсадки — в
 * `arch-rules.mjs` и `arch-rules.test.mjs`; здесь только обход и защиты.
 *
 * ЗАЩИТЫ ОТ СЛЕПОТЫ — они же главное, что унаследовано от прежней обёртки:
 *   ① обойдено меньше порога файлов — падение, даже если нарушений нет;
 *   ② относительный импорт, который не нашёлся на диске, — падение:
 *      это разбор ошибся, и молчать о нём значит видеть не весь граф.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { cycles, importsOf, orphans, resolveSpec, violations } from "./arch-rules.mjs";

const SCOPE = ["backend", "bridge", "frontend"];
const SKIP = new Set(["node_modules", "dist", "migrations", "test-results", "playwright-report"]);
const CODE = /\.(ts|tsx)$/u;

/**
 * Меньше этого числа файлов — обход не состоялся. На 26.09 их больше
 * трёхсот; порог держим много ниже: он ловит обвал, а не «файлов меньше».
 */
const FLOOR = 150;

function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (CODE.test(name)) out.push(path.split(sep).join("/"));
  }
  return out;
}

const files = SCOPE.flatMap((dir) => filesIn(dir));
const exists = (path) => existsSync(path) && statSync(path).isFile();

const graph = new Map(files.map((file) => [file, new Set()]));
const unresolved = [];
for (const file of files) {
  for (const spec of importsOf(readFileSync(file, "utf8"))) {
    const target = resolveSpec(file, spec, exists);
    if (target === undefined) unresolved.push(`${file} → ${spec}`);
    else if (target !== null && CODE.test(target)) graph.get(file)?.add(target);
  }
}

const problems = [];
for (const one of violations(graph)) {
  problems.push(`${one.rule}: ${one.from} → ${one.to}\n      ${one.why}`);
}
for (const part of cycles(graph)) {
  problems.push(`клубок: ${part.join(" → ")}\n      Разорви через модуль-лист.`);
}
for (const file of orphans(graph)) {
  problems.push(
    `сирота: ${file}\n      Никто не импортирует — мёртвый код либо забыли подключить.`,
  );
}

let blind = false;
if (unresolved.length > 0) {
  blind = true;
  console.error(`\nГраницы модулей: импорты, которых нет на диске (${unresolved.length}):`);
  for (const line of unresolved) console.error(`  ${line}`);
  console.error(
    "  ПОЧИНИТЬ: либо импорт и правда битый, либо разбор путей не понял запись —\n" +
      "  тогда учи resolveSpec. Граф без этих рёбер — неполный, и «чисто» по нему врёт.",
  );
}
if (files.length < FLOOR) {
  blind = true;
  console.error(
    `\nГраницы модулей: обойдено ${files.length} файлов, ожидалось не меньше ${FLOOR}.\n` +
      "  ПОЧИНИТЬ: обход не состоялся — смотреть было не на что, а не «всё чисто».",
  );
}

if (problems.length > 0) {
  console.error(`\nГраницы модулей: нарушений ${problems.length}\n`);
  for (const problem of problems) console.error(`  ${problem}`);
}

if (blind || problems.length > 0) process.exit(1);

const edges = [...graph.values()].reduce((sum, set) => sum + set.size, 0);
console.log(`границы модулей: ${files.length} файлов, ${edges} связей, нарушений нет — OK`);
