#!/usr/bin/env node

/**
 * Условия замера числами: тихо ли на стенде (task-091, П-1).
 *
 * ЗАЧЕМ. 16.09.2026, готовя замер на трёх тысячах вкладок, я посмотрел,
 * на чём мы вообще меряем, — и нашёл, что в той же машине Docker живут
 * семнадцать чужих контейнеров другого проекта. Все прежние числа сняты
 * рядом с ними, и ни в одном отчёте это не названо.
 *
 * Правило проекта требует называть условия замера. До сих пор их называл
 * человек по памяти — то есть не называл. Теперь их называет прибор.
 *
 * ⚠️ ЭТО НЕ ГЕЙТ И НЕ ЗАПРЕТ. Он ничего не гасит и никого не судит:
 * говорит, что видит, и отвечает кодом выхода на один вопрос — можно ли
 * считать сегодняшний замер чистым. Гасить чужое — решение человека,
 * у которого могут быть свои причины держать соседей поднятыми.
 *
 * Запуск: make conditions
 */

import { execFileSync } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";

/** Наши контейнеры зовутся так: всё прочее в этой машине Docker — чужое. */
const OURS = /^amplifie[-_]/u;

/**
 * Выше этого процессор сервера в покое считается занятым.
 *
 * Пять процентов — это опрос Prometheus раз в пять секунд и сердцебиение,
 * то есть наш собственный фон. Всё, что сверху, приехало со стороны.
 */
const QUIET_CPU = 5;

/**
 * Всплеск чужого выше этого числа отдельно назван причиной.
 *
 * Половина ядра — уже не фон. Вредит он не мощностью, а ПОВТОРИМОСТЬЮ:
 * два одинаковых прогона дадут разные числа, и мы не узнаем, почему.
 */
const SPIKE = 50;

/**
 * Сколько проб берём.
 *
 * ⚠️ НЕ ОДНУ, И ЭТО НАШЕ ЖЕ ПРАВИЛО, ЗАБЫТОЕ ЧЕРЕЗ ЧАС ПОСЛЕ ЗАПИСИ.
 * Первая версия этого прибора спрашивала Docker однажды — и поймала
 * всплеск соседа в 106% процессора. Я записал это как «сосед ест целое
 * ядро постоянно» и сказал так владельцу. Шесть проб показали правду:
 * обычно 9-22% из 300%, а сотня — редкий выброс.
 *
 * Разница важна: постоянный сосед крадёт мощность, а всплескивающий
 * портит повторимость. Одна проба не отличает одно от другого — как
 * не отличает и никакой другой единичный замер.
 */
const SAMPLES = Number(process.env.SAMPLES ?? 5);

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 });
}

function sample() {
  const rows = docker([
    "stats",
    "--no-stream",
    "--format",
    "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}",
  ])
    .split("\n")
    .map((one) => one.trim())
    .filter(Boolean);
  return rows.map((row) => {
    const [name, cpu, memory] = row.split("\t");
    return { name, cpu: Number((cpu ?? "0").replace("%", "")), memory, ours: OURS.test(name) };
  });
}

/** Середина ряда: устойчива к одному выбросу, в отличие от среднего. */
function middle(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Несколько проб, сведённых по контейнеру: обычное значение и худшее.
 * Обычное отвечает «сколько крадут», худшее — «насколько прыгают».
 */
function containers() {
  const takes = [];
  for (let n = 0; n < SAMPLES; n++) takes.push(sample());
  const names = [...new Set(takes.flat().map((one) => one.name))];
  return names.map((name) => {
    const seen = takes.map((take) => take.find((one) => one.name === name)).filter(Boolean);
    const loads = seen.map((one) => one.cpu);
    return {
      name,
      cpu: middle(loads),
      peak: Math.max(...loads),
      memory: seen.at(-1)?.memory ?? "—",
      ours: OURS.test(name),
    };
  });
}

function machine() {
  const raw = docker(["info", "--format", "{{.NCPU}}\t{{.MemTotal}}"]).trim().split("\t");
  return { cores: Number(raw[0]), bytes: Number(raw[1]) };
}

const gb = (bytes) => (bytes / 1e9).toFixed(1);

let all;
let vm;
try {
  vm = machine();
  all = containers();
} catch (error) {
  console.error(`не удалось расспросить Docker: ${error.message}`);
  console.error("  ПОЧИНИТЬ: стек должен быть поднят — make up");
  process.exit(2);
}

const strangers = all.filter((one) => !one.ours);
const ourApi = all.find((one) => one.name.includes("api"));
const busiest = [...all].sort((a, b) => b.peak - a.peak)[0];
const load = all.reduce((sum, one) => sum + one.cpu, 0);
const strangerLoad = strangers.reduce((sum, one) => sum + one.cpu, 0);

console.log("── условия стенда ─────────────────────────────────");
console.log(
  `хозяин:        ${cpus().length} ядер · ${gb(totalmem())} ГБ, свободно ${gb(freemem())} ГБ`,
);
console.log(`машина Docker: ${vm.cores} ядер из ${cpus().length} · ${gb(vm.bytes)} ГБ`);
console.log(`контейнеров:   ${all.length}, из них чужих ${strangers.length}`);
console.log(
  `процессор:     занято ${load.toFixed(0)}% из ${vm.cores * 100}% В ПОКОЕ ` +
    `(чужими ${strangerLoad.toFixed(0)}%, ${SAMPLES} проб)`,
);
if (busiest) {
  console.log(
    `самый громкий: ${busiest.name} — обычно ${busiest.cpu.toFixed(0)}%, ` +
      `всплеск до ${busiest.peak.toFixed(0)}%`,
  );
}
if (ourApi) {
  console.log(
    `наш сервер:    ${ourApi.name} — ${ourApi.cpu.toFixed(0)}%, ` +
      `всплеск ${ourApi.peak.toFixed(0)}%, ${ourApi.memory}`,
  );
}

const reasons = [];
if (strangers.length > 0) {
  const names = strangers
    .slice(0, 3)
    .map((one) => one.name)
    .join(", ");
  reasons.push(
    `чужих контейнеров ${strangers.length} (${names}${strangers.length > 3 ? ", …" : ""}), ` +
      `они берут ${strangerLoad.toFixed(0)}% процессора в покое`,
  );
}
if (ourApi && ourApi.cpu > QUIET_CPU) {
  reasons.push(`сервер в покое ест ${ourApi.cpu.toFixed(0)}% при пороге ${QUIET_CPU}%`);
}
if (busiest && !busiest.ours && busiest.peak > SPIKE) {
  reasons.push(
    `чужой ${busiest.name} всплескивает до ${busiest.peak.toFixed(0)}% — повторимости не будет`,
  );
}

console.log("");
if (reasons.length === 0) {
  console.log("стенд тихий — замер можно считать чистым");
  process.exit(0);
}

console.log("⚠️ СТЕНД НЕ ТИХИЙ, и числа замера будут про эту обстановку, а не про сервер:");
for (const one of reasons) console.log(`   · ${one}`);
console.log("");
console.log("   ПОЧИНИТЬ: погасить чужое и повторить. Гасить сам не буду —");
console.log("   это чужие контейнеры, и у них может быть своя работа.");
process.exit(1);
