/**
 * Коммит, который сейчас делается: git и признаки `--amend` — одни на все проверки хука
 * `commit-msg` (`check-cycle.mjs`, `tools/agent/review-audit.mjs`).
 *
 * ⚠️ ОТМЕТКУ AMEND СНИМАЕТ ХУК, А НЕ ПРОВЕРКА. Проверок в хуке несколько; съешь отметку
 * первая — вторая сочла бы дописывание новым коммитом и сравнивала бы не с тем (второй
 * разбор критика task-124). `.githooks/commit-msg` удаляет её после всех проверок.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function git(...args) {
  const run = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: run.status === 0, out: (run.stdout ?? "").trim(), err: (run.stderr ?? "").trim() };
}

/** Отметка `--amend`, которую оставляет `prepare-commit-msg`. */
export function amendMark() {
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

/**
 * С чем сравнивать индекс: дописывая коммит — с ЕГО родителем, иначе видна только
 * добавка, и лежащее в исходном коммите «пропало бы» (разбор критика task-116, п. 6).
 */
export function commitBase() {
  const mark = amendMark();
  const amending = (mark !== null && existsSync(mark)) || sameAuthorAsHead();
  return amending ? "HEAD^" : "HEAD";
}
