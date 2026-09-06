#!/usr/bin/env node
/**
 * Прогон вшитых записей каталога AQK.
 *
 * ЗАЧЕМ ОБЁРТКА, А НЕ ПЯТЬ СТРОК В MAKEFILE. Гейты — сценарии оболочки,
 * а разработка идёт на Windows. Один вход на Node запускает их одинаково
 * здесь и в конвейере, и печатает разом ВСЕ нарушения, а не первое:
 * агент, получивший одну ошибку из пяти, чинит по кругу.
 *
 * ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО. Список гейтов не выдуман — он читается из
 * .aqk.yml, единственного места, где объявлено, какие проверки у проекта
 * есть. Второй список разошёлся бы с первым, и оба стали бы врать.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MANIFEST = ".aqk.yml";
const VENDORED = "bash gates/";

/** Строки внутри блока `gates:` — без комментариев и пустых. */
function gateBlockLines(text) {
  const lines = [];
  let inside = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/u, "").replace(/\s+$/u, "");
    if (!line.trim()) continue;
    if (/^gates:\s*$/u.test(line)) {
      inside = true;
      continue;
    }
    if (!/^\s/u.test(line)) inside = false;
    else if (inside) lines.push(line.trim());
  }
  return lines;
}

/** `имя: "команда"` → запись, либо null. */
function parseEntry(line) {
  const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
  if (!match) return null;
  const cmd = (match[2] ?? "").trim().replace(/^["']|["']$/gu, "");
  return cmd.startsWith(VENDORED) ? { name: match[1], cmd } : null;
}

/** Имена, объявленные больше одного раза. */
function repeatedNames(gates) {
  const count = new Map();
  for (const gate of gates) count.set(gate.name, (count.get(gate.name) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([name]) => name);
}

const gates = gateBlockLines(readFileSync(MANIFEST, "utf8")).map(parseEntry).filter(Boolean);

if (gates.length === 0) {
  console.log(`в ${MANIFEST} не объявлено ни одной вшитой записи — проверять нечего`);
  process.exit(0);
}

// Повтор имени — это два разных ответа на вопрос «как проверяется X».
// Молча взять последний нельзя: расхождение манифеста надо показывать.
const repeated = repeatedNames(gates);
if (repeated.length > 0) {
  console.error(`в ${MANIFEST} запись объявлена дважды: ${repeated.join(", ")}`);
  console.error("ПОЧИНИТЬ: оставь одно объявление. Два — это два арбитра на одно правило.");
  process.exit(1);
}

const failed = [];
for (const gate of gates) {
  const run = spawnSync(gate.cmd, { shell: true, encoding: "utf8" });
  const ok = run.status === 0;
  console.log(`${ok ? "✔" : "✘"} ${gate.name}`);
  if (!ok) failed.push({ ...gate, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() });
}

if (failed.length > 0) {
  console.error(`\nзаписей не прошло: ${failed.length} из ${gates.length}\n`);
  for (const gate of failed) console.error(`${gate.name}\n${gate.output}\n`);
  process.exit(1);
}
console.log(`записей: ${gates.length}, все прошли — OK`);
