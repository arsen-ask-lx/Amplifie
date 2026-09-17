/**
 * Сколько строк Postgres потрогал, чтобы ответить, — по плану `EXPLAIN ANALYZE`.
 *
 * Вынесено из гейта цены (task-100): замеру поиска нужен тот же счёт,
 * а две копии одного правила разошлись бы на первой правке.
 */

/**
 * Сумма прочитанных строк по всему плану.
 *
 * Складываем по каждому узлу выданные строки И ОТБРОШЕННЫЕ фильтром:
 * столько Postgres действительно потрогал, чтобы ответить. Верхнее число
 * одного узла обмануло бы — обход прячется внутри.
 *
 * ⚠️ ОТБРОШЕННЫЕ СЧИТАЮТСЯ, И ЭТО ИСПРАВЛЕНИЕ СЛЕПОТЫ. Первая редакция
 * брала только `Actual Rows`, а это строки ПОСЛЕ фильтра. Обход индекса,
 * который читал пятьдесят тысяч своих реплик и выбрасывал их условием
 * «не свои», выглядел нулём — гейт был зелёным на стенде и покраснел
 * только в чистой базе конвейера, где планировщик выбрал обход таблицы.
 * Числа — на узел за один проход, как и `Actual Rows`; проходов — `Loops`.
 */
const DISCARDED = [
  "Rows Removed by Filter",
  "Rows Removed by Index Recheck",
  "Rows Removed by Join Filter",
];

export function planRows(node) {
  const touched = DISCARDED.reduce(
    (total, key) => total + (node[key] ?? 0),
    node["Actual Rows"] ?? 0,
  );
  const own = touched * (node["Actual Loops"] ?? 1);
  const children = [...(node.Plans ?? []), ...(node.Subplans ?? [])];
  return children.reduce((total, one) => total + planRows(one), own);
}
