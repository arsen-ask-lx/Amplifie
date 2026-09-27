/**
 * Диапазоны прочитанных строк — одно правило склейки на две сверки: план с делом
 * (`trace-rules.mjs`) и хук чтения (`read-guard-rules.mjs`). Разойдись они — и два сторожа
 * по-разному считали бы «прочитано целиком» (ревью task-124).
 */

/** Добавить диапазон `[с, по]`, склеив пересекающиеся и соседние. */
export function addRange(ranges, [from, to]) {
  const all = [...ranges, [from, to]].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const one of all) {
    const last = merged.at(-1);
    if (last && one[0] <= last[1] + 1) last[1] = Math.max(last[1], one[1]);
    else merged.push([...one]);
  }
  return merged;
}
