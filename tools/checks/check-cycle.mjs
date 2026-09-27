#!/usr/bin/env node
/**
 * Гейт: план, тест, спека и ревью названы в каждом коммите продукта (task-116).
 *
 * ДВА ВХОДА, ОДНО ПРАВИЛО (`cycle-rule.mjs`).
 *   `--staged <файл-сообщения>` — хук `commit-msg`: коммит ещё не сделан,
 *      его можно не дать сделать;
 *   без аргументов — ВСЕ коммиты от появления правила до HEAD.
 *
 * ⚠️ ДИАПАЗОН, А НЕ ПОСЛЕДНИЙ КОММИТ (разбор критика task-116, замечание 1).
 * Конвейер на рабочей ветке не запускается, а проверка одного HEAD прячет
 * обход хука за следующим коммитом документов: код ключом мимо хука,
 * потом «docs: ход» — и зелёно. Поэтому смотрится вся история правила.
 *
 * ⚠️ ПЛАН ЧИТАЕТСЯ ИЗ GIT, А НЕ С ДИСКА. Незакоммиченный план в рабочей
 * папке не должен засчитываться, а в чужом клоне его нет вовсе.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { verdict } from "./cycle-rule.mjs";
import { NAME_STATUS, parseChanges, parsePaths } from "./git-changes.mjs";

const RULE = "tools/checks/cycle-rule.mjs";

function git(...args) {
  const run = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: run.status === 0, out: (run.stdout ?? "").trim(), err: (run.stderr ?? "").trim() };
}

function die(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

/**
 * План `task-NNN` из дерева git: `tree` — `HEAD`-подобная ссылка либо
 * пустая строка для индекса (`git show :путь`).
 */
function planReader(tree) {
  const listing =
    tree === ""
      ? git("ls-files", "-z", "dock/tasks")
      : git("ls-tree", "-r", "--name-only", "-z", tree, "dock/tasks");
  const files = parsePaths(listing.out);
  return (number) => {
    const path = files.find((one) => one.startsWith(`dock/tasks/task-${number}-`));
    if (!path) return null;
    const text = git("show", `${tree}:${path}`).out;
    const status = /^Статус:\s*(.*)$/mu.exec(text)?.[1]?.trim() ?? "";
    return { path, status };
  };
}

/** Какой коммит сейчас дописывается `--amend`: отметку оставляет `prepare-commit-msg`. */
function amendMark() {
  const dir = git("rev-parse", "--git-dir").out;
  return dir ? join(dir, "amplifie-amend") : null;
}

/**
 * Второй признак amend — для `--amend -m`, когда `prepare-commit-msg` получает
 * источник `message` и отметки не ставит. Git переносит дату и автора
 * исходного коммита в окружение хука (`GIT_AUTHOR_DATE=@секунды`), новый
 * коммит получает дату «сейчас». Совпадение с HEAD до секунды и по автору —
 * это дописывание. Ложное срабатывание — второй коммит того же автора в ту же
 * секунду; тогда сравнение идёт с коммитом раньше, а `make cycle` всё равно
 * проверит оба по отдельности.
 */
function sameAuthorAsHead() {
  const date = /^@(\d+)/u.exec(process.env.GIT_AUTHOR_DATE ?? "")?.[1];
  if (!date) return false;
  const head = git("log", "-1", "--format=%at %ae").out.split(" ");
  return head[0] === date && head[1] === (process.env.GIT_AUTHOR_EMAIL ?? "");
}

function staged(messagePath) {
  const mark = amendMark();
  const marked = mark !== null && existsSync(mark);
  if (marked) rmSync(mark, { force: true });
  const amending = marked || sameAuthorAsHead();
  // Дописывая коммит, сравниваем с ЕГО родителем: иначе видна только добавка,
  // и тест, лежащий в исходном коммите, «пропал бы» (замечание 6).
  const base = amending ? "HEAD^" : "HEAD";
  const hasBase = git("rev-parse", "--verify", "-q", base).ok;
  const diff = hasBase
    ? git("diff", "--cached", ...NAME_STATUS, "-M", base)
    : git("diff", "--cached", ...NAME_STATUS, "--root");
  if (!diff.ok) die(["цикл: не удалось прочитать индекс git", `  ${diff.err}`]);
  let message = "";
  try {
    message = readFileSync(messagePath, "utf8");
  } catch (error) {
    die([`цикл: не удалось прочитать сообщение коммита (${messagePath})`, `  ${String(error)}`]);
  }
  const merging = existsSync(join(git("rev-parse", "--git-dir").out, "MERGE_HEAD"));
  const commit = { changes: parseChanges(diff.out), message, parents: merging ? 2 : 1 };
  return [{ name: "коммит, который вы делаете", got: verdict(commit, planReader("")) }];
}

/** Коммиты от появления правила до HEAD, старые первыми. */
function rangeCommits() {
  const born = git("log", "--diff-filter=A", "--format=%H", "--", RULE)
    .out.split("\n")
    .filter(Boolean);
  const start = born[born.length - 1];
  if (!start) {
    if (git("rev-parse", "--is-shallow-repository").out === "true") {
      die([
        "цикл: клон обрезан — коммита, где появилось правило, не видно.",
        "  ПОЧИНИТЬ: полная история — в конвейере `actions/checkout` с `fetch-depth: 0`.",
        "  Зелёный ответ на пустой выборке хуже отсутствующего гейта (Р-015).",
      ]);
    }
    return [];
  }
  // Сам коммит правила — тоже в выборке: `HEAD ^start^` берёт его и всё после.
  const since = git("rev-parse", "--verify", "-q", `${start}^`).ok ? [`^${start}^`] : [];
  return git("rev-list", "--reverse", "--no-merges", "HEAD", ...since)
    .out.split("\n")
    .filter(Boolean);
}

function history() {
  return rangeCommits().map((sha) => {
    const changes = parseChanges(
      git("diff-tree", "--no-commit-id", ...NAME_STATUS, "-r", "-M", "--root", sha).out,
    );
    const message = git("log", "-1", "--format=%B", sha).out;
    const subject = message.split("\n")[0] ?? "";
    const got = verdict({ changes, message, parents: 1 }, planReader(sha));
    return { name: `${sha.slice(0, 7)} ${subject.slice(0, 70)}`, got };
  });
}

const [mode, messagePath] = process.argv.slice(2);
if (mode === "--staged" && !messagePath) {
  die(["цикл: с `--staged` нужен путь к файлу сообщения коммита"]);
}

const results = mode === "--staged" ? staged(messagePath) : history();
const failed = results.filter((one) => !one.got.ok);

if (failed.length === 0) {
  const needed = results.filter((one) => one.got.needed).length;
  const what =
    mode === "--staged" ? results[0].got.note : `коммитов ${results.length}, с кодом ${needed}`;
  console.log(`цикл план-тест-спека-ревью: ${what} — OK`);
  process.exit(0);
}

console.error("\nЦикл «план — тест — спека — ревью» не назван в коммите.\n");
for (const one of failed) {
  console.error(`  ${one.name}`);
  for (const problem of one.got.problems) console.error(`    ${problem.step}: ${problem.why}`);
}
console.error(
  [
    "",
    "  ПОЧИНИТЬ: в сообщении коммита по строке на ступень —",
    "",
    "    план: task-NNN                        (план одобрен или на ревью)",
    "    тест: <что проверяет>                 (засчитан тест своей стороны в коммите)",
    "    спека: <id изменения openspec>        (изменение тронуто этим коммитом)",
    "    ревью: ocr — замечаний N, принято M   (make review + /delegate-review)",
    "",
    "  Ступень правда не нужна — скажи это с причиной не короче десяти знаков:",
    "",
    "    спека: не требуется — поведение не меняется, только перенос файла",
    "",
    "  Правка совсем маленькая (цвет, отступ, текст подсказки) — одной строкой",
    "  вместо четырёх:",
    "",
    "    мелочь: сменён цвет одной кнопки, поведение то же",
    "",
    "  Разделы «Сделано:» и «Не уверен:» нужны и мелочи — их ждёт отдельный гейт.",
    "",
    "  Отказ от ПЛАНА и мелочь недопустимы на feat, миграции, общем договоре, новой двери",
    "  и больше чем пяти продуктовых файлах — там план обязателен (dock/tasks/README.md).",
    mode === "--staged"
      ? ""
      : "\n  Коммит уже сделан: если он ещё не отправлен — перепиши его сообщение;\n" +
        "  иначе это решение владельца, а не повод ослабить правило.",
  ].join("\n"),
);
process.exit(1);
