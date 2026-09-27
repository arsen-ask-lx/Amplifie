/**
 * Когда карта проекта обязана меняться вместе с коммитом.
 *
 * ЗАЧЕМ. Свод говорит дословно: «статус живёт здесь и в git, а не разбросан
 * по документам» (`dock/README.md`). Правило записано с первого дня, а
 * сторожа у него не было — и это ровно тот случай, против которого написан
 * `promise-has-gate`: правило, за которым не следит никто, через месяц
 * отличается от лозунга только длиной. Здесь сторож появляется.
 *
 * ⚠️ ТРИГГЕРЫ УЗКИЕ НАМЕРЕННО, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА. Требовать
 * карту на КАЖДЫЙ коммит значит краснеть на исправной работе; такой гейт
 * обходят `--no-verify` на второй день — а это уже ловит `gate-not-weakened`,
 * и человек оказывается между двумя красными. Поэтому здесь только то,
 * о чём карта УТВЕРЖДАЕТ факт: реестр решений, история задач, реестр долга
 * и раздел «что построено».
 *
 * ⚠️ ЧИСТОЕ ПРАВИЛО ОТДЕЛЬНО ОТ ЗАПУСКА. Здесь нет ни git, ни файловой
 * системы — значит правило проверяется подсаженным нарушением в обычном
 * тесте (`map-rule.test.mjs`), а не рассуждением о том, как оно себя ведёт.
 */

/** Карта проекта. Единственный файл, который считается её обновлением. */
export const MAP = "dock/README.md";

/**
 * Что заставляет карту устареть.
 *
 * `newOnly` — правило срабатывает только на ПОЯВЛЕНИИ файла. Правка
 * существующей ручки карту не трогает; новая дверь наружу — трогает,
 * потому что карта перечисляет, что построено.
 */
const TRIGGERS = [
  {
    at: /^dock\/decisions\.md$/u,
    why: "реестр решений в карте",
    newOnly: false,
  },
  {
    at: /^dock\/tasks\/task-[^/]+\.md$/u,
    why: "история задач и очередь работ",
    newOnly: false,
  },
  {
    at: /^dock\/debt\.md$/u,
    why: "очередь работ ссылается на реестр долга",
    newOnly: false,
  },
  {
    at: /^backend\/migrations\/[^/]+\.sql$/u,
    why: "форма хранимых данных — раздел «что построено»",
    newOnly: false,
  },
  {
    at: /^backend\/src\/surface\/http\/routes\/[^/]+\.ts$/u,
    why: "новая дверь наружу",
    newOnly: true,
  },
  {
    at: /^frontend\/src\/(?:app|screens)\/(?:[^/]+\/)?[^/]+Screen\.tsx$/u,
    why: "новый экран",
    newOnly: true,
  },
];

/**
 * Отказ, названный вслух.
 *
 * ⚠️ ЛАЗЕЙКА ЕСТЬ, И ОНА НАМЕРЕННАЯ. Опечатка в решении карту не меняет,
 * и гейт, у которого нет честного выхода, обходят нечестным. Разница
 * в том, что этот выход ВИДЕН: он остаётся в сообщении коммита навсегда,
 * а `--no-verify` не оставляет следа нигде.
 *
 * Причина обязательна и не короче десяти знаков: «карта: не требуется — да»
 * это не причина, а способ пройти мимо.
 */
const REFUSAL = /^\s*карта:\s*не требуется\s*[—:-]?\s*(.+)$/mu;
const REASON_MIN = 10;

/** Слитый и отменяющий коммит содержимого не несёт — спрашивать не о чем. */
const NOT_MINE = /^\s*(Merge|Revert)\b/u;

/**
 * Изменение в коммите.
 *
 * @typedef {{ status: string, path: string }} Change
 *   status — буква git: `A` добавлен, `M` изменён, `D` удалён, `R` переименован.
 */

/**
 * Первый подошедший триггер для одного изменения — или null.
 *
 * Отдельной функцией не ради красоты: вложенный перебор с двумя пропусками
 * читался только целиком, и линтер сложности был прав. Удалённый файл
 * триггером не считается — карта о нём больше ничего не утверждает.
 */
function triggerFor(change) {
  if (change.status === "D") return null;
  return (
    TRIGGERS.find(
      (trigger) => trigger.at.test(change.path) && !(trigger.newOnly && change.status !== "A"),
    ) ?? null
  );
}

/** Сработавшие триггеры: по одному на каждый повод обновить карту. */
export function needsMap(changes) {
  return changes
    .map((change) => ({ change, trigger: triggerFor(change) }))
    .filter((one) => one.trigger !== null)
    .map((one) => ({ path: one.change.path, why: one.trigger.why }));
}

/** Отказ с причиной — или null, если его нет либо причина не названа. */
export function refusalIn(message) {
  const found = REFUSAL.exec(message ?? "");
  const reason = found?.[1]?.trim() ?? "";
  return reason.length >= REASON_MIN ? reason : null;
}

/**
 * Вердикт по одному коммиту.
 *
 * Возвращает и исход, и числа: сколько изменений посмотрено и что именно
 * сработало. Гейт, который печатает только «ок», неотличим от гейта,
 * которому нечего было смотреть (Р-015).
 *
 * @param {{ changes: Change[], message: string }} commit
 */
export function verdict(commit) {
  const changes = commit.changes ?? [];
  const message = commit.message ?? "";

  if (NOT_MINE.test(message)) {
    return { ok: true, seen: changes.length, triggers: [], note: "слияние или отмена" };
  }

  const triggers = needsMap(changes);
  const base = { seen: changes.length, triggers };

  if (triggers.length === 0) return { ...base, ok: true, note: "поводов обновить карту нет" };
  if (changes.some((one) => one.path === MAP)) {
    return { ...base, ok: true, note: "карта обновлена тем же коммитом" };
  }

  const reason = refusalIn(message);
  if (reason) return { ...base, ok: true, note: `отказ с причиной: ${reason}` };

  return { ...base, ok: false, note: "карта не тронута" };
}
