#!/usr/bin/env node
/**
 * Отчёт арбитра К2.
 *
 * ГЛАВНОЕ ПРАВИЛО (Р-004): число агента НЕ печатается без потолка —
 * согласия людей между собой на том же корпусе. Точность против одной
 * разметки на этой задаче ничего не значит: на корпусе ICSI согласие
 * двух людей о том, что считать задачей, — каппа 0.36.
 *
 * Поэтому здесь не «сколько процентов угадал агент», а «ближе ли агент
 * к человеку, чем человек к человеку».
 */
import { existsSync, readFileSync } from "node:fs";

import { AGREEMENT, CHATTER, ceiling, scoreAgainst } from "./kappa.mjs";

const CORPUS = "arbiter/corpus.jsonl";
const SECOND = "arbiter/labels-b.json";
const AGENT = "arbiter/labels-agent.json";

const num = (v) => (v === null ? "—" : v.toFixed(3));
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});

function loadCorpus() {
  return readFileSync(CORPUS, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Строки для счётчика: своя разметка, вторая, агентская. */
function rowsOf(corpus, second, agent) {
  return corpus.map((item) => ({
    id: item.id,
    kind: item.kind,
    a: item.a,
    b: second[item.id] ?? null,
    agent: agent[item.id] ?? null,
  }));
}

function printCeiling(rows) {
  const labelled = rows.filter((r) => r.b);
  console.log("\n── потолок: согласие людей ───────────────────────────────");
  console.log(`  размечено вторым разметчиком: ${labelled.length} из ${rows.length}`);
  if (labelled.length === 0) {
    console.log("\n  ВТОРОЙ РАЗМЕТКИ НЕТ — потолка нет, мерить агента нечем.");
    console.log("  Сделать: make label  (показывает реплики по одной, ответы");
    console.log(`  ложатся в ${SECOND}; своя разметка и пояснения скрыты).`);
    return null;
  }
  const kappa = ceiling(labelled);
  console.log(`  каппа «а против б»: ${num(kappa)}`);
  console.log(`  расхождений: ${labelled.filter((r) => r.a !== r.b).length}`);
  console.log("\n  Для сравнения — та же задача в исследованиях:");
  console.log("    0.36  ICSI, разметка задач без подготовки");
  console.log("    0.47  с инструкцией, предотбором и тремя разметчиками");
  return kappa;
}

function printDisagreements(rows) {
  const split = rows.filter((r) => r.b && r.a !== r.b);
  if (split.length === 0) return;
  console.log("\n── где разошлись (самое ценное) ──────────────────────────");
  const byKind = new Map();
  for (const row of split) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
  for (const [kind, count] of [...byKind].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${String(count).padStart(3)}  ${kind}`);
  }
}

function printAgent(rows, ceilingKappa) {
  const scored = rows.filter((r) => r.agent);
  console.log("\n── агент ─────────────────────────────────────────────────");
  if (scored.length === 0) {
    console.log("  агентской разметки нет — измерять нечего");
    return;
  }
  if (ceilingKappa === null) {
    console.log("  ОТКАЗ: потолка нет, число агента без него не печатается (Р-004).");
    return;
  }
  const got = scoreAgainst(rows.filter((r) => r.b));
  console.log(`  учтено бесспорных: ${got.counted}, спорных отброшено: ${got.disputed}`);
  console.log(`  каппа «агент против человека»: ${num(got.agentKappa)}`);
  console.log(`  точность: ${num(got.precision)}   полнота: ${num(got.recall)}`);
  console.log(`\n  потолок: ${num(ceilingKappa)}`);
  const passed = got.agentKappa !== null && got.agentKappa >= ceilingKappa;
  console.log(passed ? "  ✔ порог Э0 взят: агент не хуже человека" : "  ✘ порог Э0 НЕ взят");
}

const corpus = loadCorpus();
const rows = rowsOf(corpus, readJson(SECOND), readJson(AGENT));

// Проверка до счёта, а не после: чужая метка — молчаливая порча измерения.
// Первая редакция этого файла ставила проверку после process.exit — то есть
// не ставила вовсе. Записано в журнал шишек.
for (const row of rows) {
  for (const [who, label] of [
    ["б", row.b],
    ["агент", row.agent],
  ]) {
    if (label !== null && label !== AGREEMENT && label !== CHATTER) {
      throw new Error(`${row.id}: у «${who}» неизвестная метка «${label}»`);
    }
  }
}

console.log("\nАрбитр К2 — «агент отличает договорённость от болтовни»");
console.log(`корпус: ${rows.length} реплик, ${CORPUS}`);
const mine = rows.filter((r) => r.a === AGREEMENT).length;
console.log(`первая разметка: ${mine} договорённостей, ${rows.length - mine} болтовни`);
console.log(
  "\n⚠ Корпус НАМЕРЕННО перекошен в трудные случаи. Точность и полнота\n" +
    "  на нём не переносятся на живую переписку: там договорённости реже.\n" +
    "  Здесь меряется суждение на границе, а не частота в природе.",
);

const ceilingKappa = printCeiling(rows);
printDisagreements(rows);
printAgent(rows, ceilingKappa);

// Без второй разметки отчёт неполон — это не успех.
process.exit(ceilingKappa === null ? 1 : 0);
