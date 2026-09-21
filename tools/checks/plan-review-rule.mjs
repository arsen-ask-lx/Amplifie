/**
 * План не идёт владельцу без второго прохода (task-109).
 *
 * ЗАЧЕМ. Владелец 21.09: «первый план агент пишет плохой — я каждый раз
 * вставляю промпт "прочитай полностью, будь критичнее", и он всегда находит
 * дыры». Второй проход работал — но только когда владелец о нём вспоминал.
 * Скилл сам срабатывает меньше чем в половине случаев; гейт — всегда.
 *
 * ЧТО ПРОВЕРЯЕТ. Гейт не судит, хорош ли план, — он не может. Он проверяет,
 * что второй проход БЫЛ и на него ОТВЕТИЛИ:
 * - «Прочитано» — таблица, и каждый файл в ней существует;
 * - «Варианты» — не меньше двух строк: один вариант — это не выбор;
 * - «Разбор критика» — каждое замечание с вердиктом «принято» или
 *   «отвергнуто» с причиной, либо прямо «Замечаний нет».
 * Правдивость «Прочитано» сверяет `make trace-audit` по записи сессии.
 *
 * ⚠️ ТОЛЬКО С task-108 И ТОЛЬКО НЕ ЧЕРНОВИК. Черновик ещё пишется; старые
 * планы — история, их не переписывают (как у `check-proof`). С 108, а не 109:
 * task-108 — первый план, который проходит новый порядок, и был черновиком,
 * когда правило появилось (разбор критика 21.09).
 */

/** С этого номера планы пишутся в новом порядке. */
export const FIRST = 108;

/** Причина у «отвергнуто» — не короче этого: «отвергнуто: нет» не причина. */
const REASON_MIN = 10;

/** Раздел по заголовку — до следующего заголовка того же или старшего уровня. */
function section(text, title) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^#{2,3}\\s*(?:\\d+\\.\\s*)?${title}`, "u").test(line),
  );
  if (start < 0) return null;
  const level = /^#+/u.exec(lines[start])?.[0].length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const heading = /^(#+)\s/u.exec(line);
    return heading !== null && (heading[1]?.length ?? 9) <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** Строки данных таблицы: без заголовка и черты под ним. */
const tableRows = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/u.test(line))
    .slice(1);

function readProblems(text, exists) {
  const read = section(text, "Прочитано");
  const rows = read === null ? [] : tableRows(read);
  if (rows.length === 0)
    return ["нет таблицы «Прочитано»: файл | строк | как (целиком / фрагмент)"];
  return rows
    .map((row) => /^\|\s*`([^`]+)`/u.exec(row)?.[1])
    .filter((path) => path !== undefined && !exists(path))
    .map((path) => `в «Прочитано» файл, которого нет: ${path}`);
}

function optionProblems(text) {
  const options = section(text, "Варианты");
  const rows = options === null ? [] : tableRows(options);
  return rows.length >= 2 ? [] : ["в «Варианты» меньше двух строк: один вариант — это не выбор"];
}

/**
 * Есть ли у замечания вердикт: «— принято» — или «— отвергнуто: причина».
 * Вердикт стоит после тире: «не принято» вердиктом не считается.
 */
function hasVerdict(item) {
  if (/—\s*принято/u.test(item)) return true;
  const rejected = /—\s*отвергнуто[\s:—-]*(.*)$/u.exec(item);
  return (rejected?.[1]?.trim().length ?? 0) >= REASON_MIN;
}

function reviewSectionProblems(text) {
  const review = section(text, "Разбор критика");
  if (review === null) return ["нет раздела «Разбор критика»: план не прошёл второй проход"];
  const items = review.split("\n").filter((line) => /^\s*-\s/u.test(line));
  // «Замечаний нет» — только когда их и правда нет: пунктов ниже она не прячет.
  if (items.length === 0) {
    return /замечаний нет/iu.test(review)
      ? []
      : ["«Разбор критика» пуст: ни замечаний, ни строки «Замечаний нет»"];
  }
  return items
    .filter((item) => !hasVerdict(item))
    .map(
      (item) =>
        `замечание без вердикта (принято / отвергнуто с причиной): ${item.trim().slice(0, 80)}`,
    );
}

/**
 * Что не так с планом. Пустой список — всё на месте или план не проверяется.
 *
 * @param {string} name — имя файла плана, `task-NNN-…md`
 * @param {string} text — содержимое
 * @param {(path: string) => boolean} exists — есть ли файл в репозитории
 */
export function reviewProblems(name, text, exists = () => true) {
  const number = Number(/^task-(\d+)/u.exec(name)?.[1] ?? 0);
  if (number < FIRST) return [];
  const status = /^Статус:\s*(.*)$/mu.exec(text)?.[1] ?? "";
  if (/черновик/iu.test(status)) return [];
  return [...readProblems(text, exists), ...optionProblems(text), ...reviewSectionProblems(text)];
}
