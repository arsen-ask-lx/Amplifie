#!/usr/bin/env node
/**
 * Гейт: карта проекта не отстаёт от коммита.
 *
 * ДВА ВХОДА, ОДНО ПРАВИЛО. `--staged <файл-сообщения>` — хук `commit-msg`:
 * коммит ещё не состоялся, и его можно не дать сделать. Без аргументов —
 * последний коммит: так гейт переживает `--no-verify` и работает в чужом
 * клоне, где хуки никто не включал. Хук удобнее, конвейер надёжнее;
 * порознь каждый дырявый.
 *
 * Само правило — в `map-rule.mjs`, и оно чистое: здесь только git.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { NAME_STATUS, parseChanges } from "./git-changes.mjs";
import { MAP, verdict } from "./map-rule.mjs";

function git(...args) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  return { ok: run.status === 0, out: (run.stdout ?? "").trim(), err: (run.stderr ?? "").trim() };
}

function die(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

/** Изменения и сообщение будущего коммита — из индекса и из файла хука. */
function staged(messagePath) {
  const diff = git("diff", "--cached", ...NAME_STATUS);
  if (!diff.ok) die(["карта: не удалось прочитать индекс git", `  ${diff.err}`]);
  let message = "";
  try {
    message = readFileSync(messagePath, "utf8");
  } catch (error) {
    die([`карта: не удалось прочитать сообщение коммита (${messagePath})`, `  ${String(error)}`]);
  }
  return { changes: parseChanges(diff.out), message, what: "коммит, который вы делаете" };
}

/**
 * Изменения и сообщение последнего коммита.
 *
 * ⚠️ У ОБРЕЗАННОГО КЛОНА РОДИТЕЛЯ НЕТ, И МОЛЧАТЬ ОБ ЭТОМ НЕЛЬЗЯ. `git show`
 * в такой копии считает коммит корневым и перечисляет ВЕСЬ репозиторий:
 * гейт краснел бы на здоровом коде либо, наоборот, зеленел на пустоте.
 * Поэтому обрезанность и настоящий первый коммит различаются явно —
 * первое отказ, второе законный ноль.
 */
function lastCommit() {
  const message = git("log", "-1", "--pretty=%B");
  if (!message.ok) die(["карта: это не репозиторий git — проверять нечего", `  ${message.err}`]);

  const parent = git("rev-parse", "--verify", "HEAD^");
  if (!parent.ok) {
    if (git("rev-parse", "--is-shallow-repository").out === "true") {
      die([
        "карта: клон обрезан — у HEAD нет родителя, и сравнивать не с чем.",
        "  ПОЧИНИТЬ: возьми глубину хотя бы два — в конвейере это",
        "  `actions/checkout` с `fetch-depth: 2`.",
        "  Зелёный ответ на пустой выборке хуже отсутствующего гейта (Р-015).",
      ]);
    }
    return { changes: [], message: message.out, what: "первый коммит репозитория" };
  }

  const diff = git("diff", ...NAME_STATUS, "HEAD^", "HEAD");
  if (!diff.ok) die(["карта: не удалось сравнить HEAD с родителем", `  ${diff.err}`]);
  return { changes: parseChanges(diff.out), message: message.out, what: "последний коммит" };
}

const [mode, messagePath] = process.argv.slice(2);
if (mode === "--staged" && !messagePath) {
  die(["карта: с `--staged` нужен путь к файлу сообщения коммита"]);
}

const commit = mode === "--staged" ? staged(messagePath) : lastCommit();
const got = verdict(commit);

if (got.ok) {
  const why = got.triggers.length > 0 ? `, поводов ${got.triggers.length}` : "";
  console.log(`карта проекта: ${commit.what}, изменений ${got.seen}${why} — ${got.note} — OK`);
  process.exit(0);
}

console.error(`\nКарта проекта устарела: ${MAP} не тронут, а он утверждает факт.\n`);
for (const one of got.triggers) console.error(`  ${one.path}\n    → ${one.why}`);
console.error(
  [
    "",
    `  ПОЧИНИТЬ: допиши в ${MAP} то, что изменилось, и добавь его в тот же коммит.`,
    "  Статус живёт в карте и в git — больше нигде. Разошлись — врут оба,",
    "  и через месяц не отличить, какой настоящий.",
    "",
    "  Если правка карты действительно не касается — скажи это вслух",
    "  строкой в сообщении коммита, с причиной:",
    "",
    "    карта: не требуется — поправлена опечатка в тексте решения",
    "",
    "  Отказ остаётся в истории и его видно. `--no-verify` не оставляет",
    "  следа нигде, и его ловит отдельный гейт.",
  ].join("\n"),
);
process.exit(1);
