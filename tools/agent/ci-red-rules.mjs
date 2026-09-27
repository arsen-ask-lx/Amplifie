/**
 * Чистые правила сторожа «CI красный — сначала разбор» (task-126, шаг 2).
 *
 * ЗАЧЕМ. Правило «красное — сначала причина» (`AGENTS.md`) неделями держалось
 * только словами: CI краснел на известных Д-78 и Д-80, а новое красное
 * (`unread-own` 27.09) легко было потерять среди них. Здесь — разбор журнала
 * упавших работ и храповика известных, без сети и без git: запуск и решение,
 * что делать с найденным, — в `ci-red-audit.mjs`.
 *
 * ⚠️ КЛЮЧ УПАВШЕГО — БЕЗ НОМЕРА СТРОКИ И НОМЕРА ТЕСТА. Playwright печатает
 * `✘  41 [chromium] › путь:21:1 › имя`: номер теста (`41`) и номер строки
 * (`21`) сдвигаются от соседней правки файла, а имя и путь — нет. Ключ с ними
 * делал бы известное падение «новым» на каждый чужой коммит выше по файлу.
 *
 * ПРЕДЕЛЫ РАЗБОРА ЖУРНАЛА (сверено на настоящих логах прогона 36329661650):
 * - Playwright — только строки вида `✘  N [браузер] › путь:стр:кол › имя (Хс)`;
 *   `✓`-строки и сводка в конце журнала не разбираются;
 * - Vitest — только строки вида `FAIL  путь > группа > имя`; групп может быть
 *   несколько, все входят в ключ как есть;
 * - Schemathesis — `___ ДВЕРЬ ___`, `N. Test Case ID`, `- Вид нарушения`; ключ —
 *   `Schemathesis › дверь › вид` (сверено на прогоне 36336053261);
 * - прочий шаг — **только если в работе не узнано ничего точнее**: упавшим считается
 *   шаг не с общим именем `UNKNOWN STEP` и со строкой `##[error]`; ключ — `работа | шаг`.
 *   ⚠️ ГРУБЫЙ: разные причины внутри шага (например, две разные поломки цены
 *   запросов) дают один ключ. Вносить такой ключ в храповик — значит признать
 *   известным весь шаг; разбор нового формата — лучше, чем такой ключ;
 * - формат `gh run view --log-failed` — с полями через таб (`работа\tшаг\tYYYY-…Z текст`);
 *   без этого префикса (текст без табов) строки не разбираются никак;
 * - упавшая работа, где ни одна строка не узнана, — ключ `работа | неразобрано`
 *   (например, фаззер под «UNKNOWN STEP»): не молчим, но и имени упавшего не знаем.
 */

const PLAYWRIGHT_FAIL =
  /✘\s+\d+\s+\[[^[\]]+\]\s+›\s+(\S+):\d+:\d+\s+›\s+(.+?)(?:\s*\(\d+(?:\.\d+)?\s*[a-zA-Zµ]+\))?\s*$/u;
const VITEST_FAIL = /FAIL\s{2}(\S.*\S|\S)\s*$/u;

/** Строка журнала `gh run view --log-failed`: `работа\tшаг\tостаток`; иначе — null. */
function splitLogLine(line) {
  const at = line.indexOf("\t");
  const second = at === -1 ? -1 : line.indexOf("\t", at + 1);
  if (at === -1 || second === -1) return null;
  return { job: line.slice(0, at), step: line.slice(at + 1, second), rest: line.slice(second + 1) };
}

/** Одно упавшее в одной строке журнала — или null, если строка не о падении. */
function failureIn({ rest }) {
  const playwright = rest.match(PLAYWRIGHT_FAIL);
  if (playwright) return `${playwright[1]} › ${playwright[2].trim()}`;
  const vitest = rest.match(VITEST_FAIL);
  if (vitest) return vitest[1].trim();
  return null;
}

/** Текст строки без отметки времени GitHub (`2026-…Z `). */
const textOf = (rest) => rest.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/u, "");

const FUZZ_HEADING = /^_{3,} (.+?) _{3,}$/u;
const FUZZ_CASE = /^\d+\. Test Case ID: /u;
const FUZZ_TITLE = /^- (.+)$/u;

/**
 * Schemathesis: заголовок `___ ДВЕРЬ ___`, затем `N. Test Case ID: …` и строка
 * `- Вид нарушения` (у первого столбца; сводка ниже — с отступом, её не берём).
 * Ключ — дверь и вид нарушения: иначе вся работа фаззера была бы одним ключом,
 * и одно признанное падение прятало бы любое другое (второе ревью task-126).
 */
function fuzzReader() {
  let door = null;
  let pendingCase = false;
  return (rest) => {
    const text = textOf(rest);
    const heading = FUZZ_HEADING.exec(text);
    if (heading) {
      door = heading[1];
      return null;
    }
    if (FUZZ_CASE.test(text)) {
      pendingCase = true;
      return null;
    }
    const title = pendingCase ? FUZZ_TITLE.exec(text) : null;
    if (!title || door === null) return null;
    pendingCase = false;
    return `Schemathesis › ${door} › ${title[1].trim()}`;
  };
}

/** Упавший шаг целиком — только когда в его работе не узнано ничего точнее. */
const stepFailure = ({ job, step, rest }) =>
  step !== "UNKNOWN STEP" && rest.includes("##[error]") ? `${job} | ${step}` : null;

function addOnce(list, seen, key) {
  if (seen.has(key)) return;
  seen.add(key);
  list.push(key);
}

/**
 * Упавшие в журнале `gh run view --log-failed`, ключами (см. пределы вверху
 * файла). Порядок — первое появление; повторы одного ключа схлопываются.
 *
 * ⚠️ УПАВШАЯ РАБОТА БЕЗ УЗНАННЫХ СТРОК — САМА УПАВШЕЕ: `работа | неразобрано`.
 * В журнал `--log-failed` попадают только упавшие работы, и если разбор не узнал
 * в работе ни строки, это новый формат, а не зелёный: `gh` свалил шаги фаззера
 * в «UNKNOWN STEP», и первая редакция теряла падение молча (ревью task-126).
 */
export function parseFailedLog(text) {
  const jobs = new Map(); // работа → { fine: [ключи], coarse: [ключи], fuzz }
  const seen = new Set();
  for (const line of String(text).split("\n")) {
    const split = splitLogLine(line);
    if (!split) continue;
    if (!jobs.has(split.job)) jobs.set(split.job, { fine: [], coarse: [], fuzz: fuzzReader() });
    const job = jobs.get(split.job);
    const fine = failureIn(split) ?? job.fuzz(split.rest);
    if (fine) addOnce(job.fine, seen, fine);
    const coarse = stepFailure(split);
    if (coarse) addOnce(job.coarse, seen, coarse);
  }
  return [...jobs].flatMap(([name, job]) => {
    if (job.fine.length > 0) return job.fine;
    if (job.coarse.length > 0) return job.coarse;
    return [`${name} | неразобрано`];
  });
}

/**
 * Упавшие, которых разбор прогона не называет. Файл разбора засчитывается, только
 * если в нём есть каждый ключ неизвестного упавшего: иначе годился бы любой файл
 * с четырьмя разделами — про другое падение (второе ревью task-126).
 */
export function analysisMissing(markdown, unknown) {
  return unknown.filter((key) => !String(markdown).includes(key));
}

/**
 * Храповик известных красных: строки `ключ | Д-NN`, `#` — комментарий, пустая
 * строка пропускается. Строка без `Д-NN` — ошибка (не молчим о битом файле).
 */
export function parseKnownRed(text) {
  const known = new Map();
  const errors = [];
  String(text)
    .split("\n")
    .forEach((raw, at) => {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) return;
      const match = line.match(/^(.+?)\s*\|\s*(Д-\d+)\s*$/u);
      if (!match) {
        errors.push(`строка ${at + 1}: нет «| Д-NN» — ${line}`);
        return;
      }
      known.set(match[1].trim(), match[2]);
    });
  return { known, errors };
}

/** Упавшие, которых нет среди известных (по ключу, без учёта тикета). */
export function unknownFailures(failures, known) {
  return failures.filter((one) => !known.has(one));
}

const REQUIRED_SECTIONS = ["Текст падения", "Класс", "Причина", "Что уже описано"];
const ALLOWED_CLASSES = ["продукт", "тест", "окружение", "инструмент"];

/** Текст раздела `## Заголовок` до следующего `##` того же уровня (или конца). */
function sectionText(markdown, title) {
  const match = markdown.match(
    new RegExp(`^##\\s+${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "mu"),
  );
  return match ? match[1].trim() : null;
}

/**
 * Файл разбора `dock/ci/<прогон>.md` полон: все четыре раздела на месте,
 * с непустым текстом, а класс — один из четырёх признанных (В-2).
 */
export function analysisComplete(markdown) {
  const texts = REQUIRED_SECTIONS.map((title) => sectionText(markdown, title));
  if (texts.some((text) => !text)) return false;
  const [, klass] = texts;
  const firstWord = klass.split(/\s/u)[0];
  return ALLOWED_CLASSES.includes(firstWord);
}
