/**
 * Правка — только после чтения файла целиком: правила хука (task-124).
 *
 * ЗАЧЕМ. Владелец 27.09: «ты грепаешь и пропускаешь важные куски кода, делаешь дубль
 * или костыль». Правило «читай целиком» жило текстом в AGENTS.md и нарушалось в той же
 * сессии. Текст модель может пропустить; хук `PreToolUse` исполняется кодом.
 *
 * ⚠️ ЗАСЧИТЫВАЕТСЯ ТОЛЬКО ИНСТРУМЕНТ Read. Его ответ сообщает, какие строки пришли и
 * сколько их в файле (`file.startLine`, `numLines`, `totalLines` — снято с настоящего
 * входа хука 27.09). У `cat` и `sed` число строк не известно, а длинный вывод оболочки
 * модель видит обрезанным — засчитывать его значило бы засчитывать неувиденное.
 *
 * ⚠️ «СОДЕРЖИМОЕ ИЗВЕСТНО» ПЕРЕЖИВАЕТ СВОЮ ПРАВКУ, НО НЕ ЧУЖУЮ И НЕ ПОЯВЛЯЕТСЯ ИЗ НЕЁ.
 * Прочитанный целиком файл после своей правки остаётся известным — перечитывать 700 строк
 * ради второй правки лишнее. Но правка сама известным не делает: поправил раздел огромного
 * документа — остальные разделы как были непрочитанными, так и остались (второй разбор
 * критика). Известным делает только полное чтение или своё создание файла. Файл,
 * изменённый снаружи, определяется по размеру и времени изменения и снова требует чтения.
 *
 * ⚠️ БОЛЬШОЙ ДОКУМЕНТ — ПО РАЗДЕЛАМ. Реестры `dock/*.md` — тысячи строк; прочесть
 * 5800 строк ради одной записи значит вытеснить из контекста саму задачу. Для `.md`
 * длиннее предела продуктового файла (800 строк) правка допустима, если целиком
 * прочитан раздел заголовка H1–H3, в котором лежит заменяемый текст; заголовки внутри
 * блоков кода — не заголовки.
 *
 * Чистые функции: без диска и процессов — всё приходит аргументами; проверяется
 * подсадками в `read-guard-rules.test.mjs`.
 */
import { addRange } from "./ranges.mjs";

/** Предел продуктового файла (`AGENTS.md`): длиннее — документ читается разделами. */
export const BIG_DOC_LINES = 800;

/** Путь от корня проекта, прямыми косыми. `cwd` — корень, как его даёт хук. */
export function relPath(path, cwd) {
  const norm = (value) => String(value).replace(/\\/gu, "/").replace(/\/+$/u, "");
  const file = norm(path);
  const root = norm(cwd);
  const lower = file.toLowerCase();
  if (lower.startsWith(`${root.toLowerCase()}/`)) return file.slice(root.length + 1);
  return file.replace(/^\.\//u, "");
}

/**
 * Какие строки дал ответ Read: `{ from, to, total }` или null.
 *
 * ⚠️ `file_unchanged` — НЕ ЧТЕНИЕ. Claude Code не отдаёт файл повторно, если он уже
 * прочитан в разговоре с теми же `offset`/`limit` и не менялся: ответ — только путь
 * (снято с записи сессии 27.09). Если то чтение было при хуке, оно уже в журнале; если
 * до сжатия контекста — текста у модели больше нет, и засчитать его значило бы соврать
 * ровно так, как это правило запрещает. Текст по-настоящему даёт Read с другими
 * `offset`/`limit` — об этом говорит отказ (`decideEdit`).
 */
export function readSpan(response) {
  const file = response?.file;
  if (!file?.totalLines || response?.type === "file_unchanged") return null;
  const from = Number(file.startLine ?? 1);
  return { from, to: from + Number(file.numLines ?? 0) - 1, total: Number(file.totalLines) };
}

/** Тот же ли файл, что при записи в журнал: размер и время изменения. */
export function sameStamp(a, b) {
  return a.size === b.size && a.mtime === b.mtime;
}

/** Покрыт ли отрезок `[from, to]` прочитанными диапазонами целиком. */
function covers(ranges, from, to) {
  return ranges.some(([a, b]) => a <= from && b >= to);
}

/**
 * Состояние по журналу: `Map<путь, { ranges, total, known, size, mtime }>`.
 *
 * События журнала:
 * - `{ t: "read", path, from, to, total, lines, size, mtime }` — ответ Read; `lines` —
 *   строк на диске в ту же минуту;
 * - `{ t: "own", path, created, size, mtime }` — своя правка; `created` — файла до неё не
 *   было, и написанное агентом известно целиком;
 * - `{ t: "reset" }` — контекст сжат или очищен: прочитанного у модели больше нет.
 */
export function stateOf(events) {
  const state = new Map();
  for (const event of events) {
    if (event.t === "reset") state.clear();
    else if (event.t === "own") state.set(event.path, afterOwn(state.get(event.path), event));
    else if (event.t === "read") state.set(event.path, afterRead(state.get(event.path), event));
  }
  return state;
}

/**
 * Своя правка: прочитанное до неё остаётся прочитанным; известным файл делает только
 * полное чтение или своё создание.
 */
function afterOwn(before, event) {
  return {
    ranges: before?.ranges ?? [],
    total: before?.total ?? null,
    known: Boolean(event.created) || Boolean(before?.known),
    size: event.size,
    mtime: event.mtime,
  };
}

function afterRead(before, event) {
  // Файл менялся между чтениями — куски прежнего текста с новыми не складываются.
  const changed = before && !sameStamp(before, event);
  const ranges = addRange(changed ? [] : (before?.ranges ?? []), [event.from, event.to]);
  // `lines` — строк на диске: Read считает и пустую строку после последнего перевода
  // строки, и файл в 63 строки у него 64 (живой случай 27.09).
  const total = event.lines ?? event.total;
  return {
    ranges,
    total,
    known: (!changed && Boolean(before?.known)) || covers(ranges, 1, total),
    size: event.size,
    mtime: event.mtime,
  };
}

/** Номера строк-заголовков H1–H3; строки внутри блоков кода — не заголовки. */
function headingLines(lines) {
  const found = [];
  let fenced = false;
  lines.forEach((text, at) => {
    if (/^\s*(```|~~~)/u.test(text)) fenced = !fenced;
    else if (!fenced && /^#{1,3}\s/u.test(text)) found.push(at + 1);
  });
  return found;
}

/** Раздел H1–H3, в котором лежит строка `line`: `[первая, последняя]` строки раздела. */
export function sectionAround(lines, line) {
  const heads = headingLines(lines);
  const start = heads.filter((at) => at <= line).at(-1) ?? 1;
  const next = heads.find((at) => at > start);
  return [start, next ? next - 1 : lines.length];
}

/**
 * Каждая строка, которую задевает замена: от первой до последней строки каждого
 * вхождения `needle`. Многострочный `old_string` может перейти через заголовок в соседний
 * раздел — тогда и тот раздел должен быть прочитан (второй разбор критика).
 */
function linesOfText(text, needle, all) {
  const found = [];
  if (!needle) return found;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const first = text.slice(0, at).split("\n").length;
    const last = first + needle.split("\n").length - 1;
    for (let line = first; line <= last; line += 1) found.push(line);
    if (!all) break;
  }
  return found;
}

const deny = (reason) => ({ allow: false, reason });
const ALLOW = { allow: true };

/**
 * Ответ без подсчёта строк — или null: файла нет или он пуст (читать нечего); известен
 * и не менялся — можно; был известен, но изменён снаружи — перечитать.
 */
function knownVerdict(path, file, entry) {
  if (file === null || file.text === "") return ALLOW;
  if (!entry?.known) return null;
  if (sameStamp(entry, file)) return ALLOW;
  return deny(
    `${path} изменён снаружи после того, как ты его прочитал или правил. ` +
      "ПОЧИНИТЬ: прочитай его заново целиком (Read без offset/limit), потом правь.",
  );
}

/** Прочитанные строки, если файл с тех пор не менялся; иначе — ничего. */
function seenRanges(file, entry) {
  const fresh = entry && sameStamp(entry, file);
  return fresh ? entry.ranges : [];
}

/** Правка большого документа: прочитан ли целиком раздел каждой задетой строки. */
function decideSections({ path, text, lines, total, seen, read, edits }) {
  const needle = (one) => String(one.old_string ?? "").replace(/\r\n/gu, "\n");
  const touched = edits.flatMap((one) => linesOfText(text, needle(one), Boolean(one.replace_all)));
  // Не нашли, что заменяется, — не знаем, какой раздел; пропускать нельзя (ревью task-124).
  if (touched.length === 0) {
    return deny(
      `${path}: не нашёл в файле заменяемый текст — какой раздел правится, неизвестно. ` +
        `ПОЧИНИТЬ: прочитай документ целиком (Read с offset=1 и limit=${total + 1}).`,
    );
  }
  const missing = touched
    .map((line) => sectionAround(lines, line))
    .filter(([from, to]) => !covers(seen, from, to));
  if (missing.length === 0) return ALLOW;
  const [from, to] = missing[0];
  return deny(
    `${path}: ${total} строк — большой документ читается разделами, и раздел со ` +
      `строками ${from}–${to} прочитан не целиком (прочитано всего ${read} строк). ` +
      `ПОЧИНИТЬ: Read с offset=${from} и limit=${to - from + 2}, потом правь.`,
  );
}

/**
 * Можно ли править файл. `file` — что на диске сейчас: `null`, если файла нет,
 * иначе `{ size, mtime, text }`. `input` — вход инструмента правки.
 *
 * Подсказки в отказе просят Read на строку больше прежнего: тот же вызов Claude Code
 * ответил бы «не менялся» и текста не отдал.
 */
export function decideEdit({ tool, path, input, file, entry }) {
  const early = knownVerdict(path, file, entry);
  if (early) return early;

  // Переводы строк Windows приводим к `\n`: Edit ищет без различия, а поиск строк
  // замены по `\r\n` не нашёл бы многострочный `old_string` (ревью task-124).
  const text = file.text.replace(/\r\n/gu, "\n");
  const lines = text.split("\n");
  const total = text.endsWith("\n") ? lines.length - 1 : lines.length;
  const seen = seenRanges(file, entry);
  const read = seen.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, total) - a + 1), 0);

  const bigDoc = path.endsWith(".md") && total > BIG_DOC_LINES;
  if (bigDoc && (tool === "Edit" || tool === "MultiEdit")) {
    const edits = tool === "MultiEdit" ? (input.edits ?? []) : [input];
    return decideSections({ path, text, lines, total, seen, read, edits });
  }
  return deny(
    `${path} прочитан не целиком: ${read} из ${total} строк. Правка по фрагменту рождает ` +
      "дубли и костыли (AGENTS.md, task-124). ПОЧИНИТЬ: прочитай его целиком " +
      "(Read без offset/limit; длинный — несколькими подряд), потом правь. " +
      `Read ответил «не менялся», а текста в контексте нет — Read с offset=1 и limit=${total + 1}.`,
  );
}

/**
 * Звенья команды: слова с учётом кавычек, делённые по `&&`, `||`, `;`, `|` и переводу
 * строки — только вне кавычек. `sed -i 's/a|b/c/' f` — одно звено, а не два (ревью
 * task-124: деление до разбора кавычек теряло цель правки).
 */
function stagesOf(command) {
  const stages = [[]];
  for (const token of command.match(/"[^"]*"|'[^']*'|&&|\|\||[;|\n]|[^\s;|&]+|&/gu) ?? []) {
    // Одиночный `&` — фоновый запуск: за ним новая команда (итоговое ревью task-124).
    if (/^(&&?|\|\||[;|\n])$/u.test(token)) stages.push([]);
    else stages.at(-1).push(token.replace(/^["']|["']$/gu, ""));
  }
  return stages.filter((one) => one.length > 0);
}

/**
 * Разбор `git status --porcelain=v1 -z`: изменённые пути и признак удаления. У
 * переименования и копии за полем `XY путь` идёт отдельное поле со старым путём —
 * без префикса; резать его как запись нельзя (ревью task-124).
 */
export function parseStatus(raw) {
  const fields = raw.split("\0");
  const found = [];
  for (let at = 0; at < fields.length; at += 1) {
    const entry = fields[at];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    found.push({ path: entry.slice(3), deleted: code.includes("D") });
    if (code.includes("R") || code.includes("C")) at += 1; // старый путь
  }
  return found;
}

/** Ключи `sed`, за которыми идёт скрипт — строкой или файлом, — а не цель правки. */
const SED_SCRIPT = new Set(["-e", "-f", "--expression", "--file"]);

/**
 * Короткие ключи GNU sed без значения — только они склеиваются перед `-i` (`-Ei`, `-ni`).
 * Любая буква вне набора может быть значением: `-fscript.sed` — файл скрипта, не `-i`.
 */
const SED_FLAGS = "nrsuzEb";

/** Правит ли ключ на месте: `-i`, `-i.bak`, `-Ei`, `--in-place`, `--in-place=.bak`. */
const isSedInPlace = (one) =>
  new RegExp(`^-[${SED_FLAGS}]*i`, "u").test(one) || /^--in-place(=|$)/u.test(one);

/** Скрипт, склеенный с ключом: `-es/a/b/`, `-fscript.sed` (у `-Ef s.sed` — отдельным словом). */
const isGluedScript = (one) => new RegExp(`^-[${SED_FLAGS}]*[ef].`, "u").test(one);

/**
 * Цели `sed -i`: слова без ключей, кроме значений `-e`/`-f`. Без этих ключей первое слово —
 * сам скрипт; с ними скрипт уже назван, и файл после `-f` читается, а не правится
 * (итоговое ревью task-124: `sed -i -f s.sed f` отказывал из-за непрочитанного `s.sed`).
 */
function sedTargets(rest) {
  const args = rest.filter((one, at) => !one.startsWith("-") && !SED_SCRIPT.has(rest[at - 1]));
  const scripted = rest.some(
    (one) => SED_SCRIPT.has(one) || /^--(expression|file)=/u.test(one) || isGluedScript(one),
  );
  return scripted ? args : args.slice(1);
}

/**
 * Какие файлы звено правит на месте: `sed -i`, `perl -i`, `Set-Content`, `Add-Content`,
 * `Out-File`, `tee`. Для прочих команд — пусто: их запись ловится после, по `git status`.
 */
function inPlaceTargets(tokens) {
  const [head, ...rest] = tokens;
  const name = (head ?? "").toLowerCase();
  const args = rest.filter((one) => !one.startsWith("-"));
  if (name === "sed" && rest.some(isSedInPlace)) {
    return sedTargets(rest);
  }
  if (name === "perl" && rest.some((one) => /^-[a-z]*i/u.test(one))) return args.slice(1);
  if (["set-content", "add-content", "out-file", "tee"].includes(name)) return args;
  return [];
}

/**
 * Можно ли выполнить команду оболочки. `known(path)` — известно ли содержимое;
 * `exists(path)` — есть ли такой файл. Отказ — только если команда правит на месте
 * существующий файл, чьё содержимое агенту не известно целиком.
 *
 * Пределы — предпроверка нарочно простая, сеть под ней — проверка после команды по
 * `git status` (ревью task-124, четвёртый и пятый круги):
 * - пути считаются от корня проекта, `cd` внутри команды не отслеживается;
 * - редкие формы ключей не разбираются: сокращение `--in` вместо `--in-place` (пропуск),
 *   склейки `perl` со значением (`-mstrict`), кавычки внутри слова (`-e's/a b/'`);
 * - склейка «флаги + `-e`/`-f`, значение следующим словом» (`-Ef s.sed`) рядом с ещё одним
 *   `-e` даёт ложный отказ по файлу скрипта — отказ называет файл, его можно прочитать.
 * Полный разбор ключей чужих программ — это переписать их getopt; мимо проверки после
 * команды правка всё равно не пройдёт.
 */
export function decideShell({ command, known, exists }) {
  for (const tokens of stagesOf(command)) {
    for (const target of inPlaceTargets(tokens)) {
      if (exists(target) && !known(target)) {
        return deny(
          `команда правит на месте ${target}, а он не прочитан целиком. ` +
            "ПОЧИНИТЬ: прочитай файл целиком (Read) и правь инструментом Edit.",
        );
      }
    }
  }
  return ALLOW;
}

/**
 * Форматтер ли в команде: `make format`, `npm run format`, `biome … --write` — в любом
 * звене, а не только в начале: `cd frontend && npx biome check --write .` — тоже он.
 */
export function isFormatter(command) {
  return stagesOf(command).some((tokens) => {
    const line = tokens.join(" ");
    return (
      /^make format\b/u.test(line) ||
      /^npm run format\b/u.test(line) ||
      (/(^|\s|\/)biome\s+(check|format)\b/u.test(line) && tokens.includes("--write"))
    );
  });
}

/**
 * Что изменила команда: `after` — `Map<путь, mtime>` изменённых в рабочем дереве файлов
 * (`git status`) после команды, `start` — время её начала. Изменено командой всё, что
 * тронуто не раньше начала: снимка до команды не нужно, а значит и второго `git status`
 * на каждый вызов оболочки (П-6).
 */
export function changedSince(after, start) {
  return [...after.entries()].filter(([, mtime]) => mtime >= start).map(([path]) => path);
}
