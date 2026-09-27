#!/usr/bin/env node
/**
 * Гейт: «не пусто» вместо значения в тестах (task-125). Правило — `weak-asserts-rule.mjs`.
 *
 * ⚠️ ХРАПОВИК ПОИМЁННО, А НЕ ЧИСЛОМ. База — список `файл | вызов в одну строку` в
 * `tools/ratchets/weak-asserts.txt`: новое место красное, место, которого больше нет, —
 * тоже красное, пока строку не уберут из списка. Число совпало бы и тогда, когда одно
 * место починили, а другое добавили (разбор критика task-125, замечание 9). Ключ — сам
 * вызов, а не номер строки: номер съезжает от любой соседней правки. При двух одинаковых
 * вызовах и одной записи новым называется нижний (названный предел).
 *
 * Список файлов — из git (`ls-files`), текст — из рабочей папки: гейт идёт в `make check`
 * до коммита и в CI, где рабочая папка и есть коммит. Одинаковые строки считаются с
 * количеством: иначе новое место с тем же текстом прошло бы под старой записью.
 *
 * Запуск: make weak-asserts
 */
import { existsSync, readFileSync } from "node:fs";

import { parsePaths } from "./git-changes.mjs";
import { git } from "./git-commit.mjs";
import { weakAsserts } from "./weak-asserts-rule.mjs";

const RATCHET = "tools/ratchets/weak-asserts.txt";
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mjs)$/u;
/** Образцы гейтов — нарочно плохие тесты, их не трогаем. */
const SAMPLES = /^tools\/gates\//u;

const key = (path, text) => `${path} | ${text}`;

function known() {
  return readFileSync(RATCHET, "utf8")
    .split("\n")
    .map((one) => one.trim())
    .filter((one) => one && !one.startsWith("#"));
}

/** Сколько раз встречается каждый ключ: одинаковые строки в файле — не одна запись. */
function counted(keys) {
  const counts = new Map();
  for (const one of keys) counts.set(one, (counts.get(one) ?? 0) + 1);
  return counts;
}

/** Текст файла из рабочей папки; пропавший с диска — пропуск с предупреждением. */
function textOf(path) {
  if (existsSync(path)) return readFileSync(path, "utf8");
  console.warn(`нет на диске, пропущен: ${path} (удалён без git rm?)`);
  return "";
}

const files = parsePaths(git("ls-files", "-z").out).filter(
  (path) => TEST_FILE.test(path) && !SAMPLES.test(path),
);
const found = files.flatMap((path) => weakAsserts(textOf(path)).map((one) => ({ path, ...one })));
const base = counted(known());
const seen = counted(found.map((one) => key(one.path, one.text)));

// Больше, чем записано, — новое (последние по порядку); меньше — стало лучше.
const fresh = found.filter((one, at) => {
  const name = key(one.path, one.text);
  const before = found.slice(0, at + 1).filter((o) => key(o.path, o.text) === name).length;
  return before > (base.get(name) ?? 0);
});
const gone = [...base].filter(([name, count]) => (seen.get(name) ?? 0) < count).map(([n]) => n);

console.log(`тестовых файлов ${files.length}, «не пусто» вместо значения — ${found.length}`);

if (fresh.length > 0) {
  console.error("\nНОВОЕ «не пусто» вместо значения:");
  for (const one of fresh) console.error(`  ${one.path}:${one.line}  ${one.text}`);
  console.error(
    "\n  ПОЧИНИТЬ: проверь точное значение (toBe, toEqual, toMatchObject). «Не пусто»\n" +
      "  пройдёт и на неверном ответе. Сторож перед точной проверкой того же значения\n" +
      "  в этом же тесте — законен (скилл test-quality).",
  );
}
if (gone.length > 0) {
  console.error(`\nстало лучше, чем записано — убери из ${RATCHET}:`);
  for (const one of gone) console.error(`  ${one}`);
}
if (fresh.length > 0 || gone.length > 0) process.exit(1);
console.log("новых нет — OK");
