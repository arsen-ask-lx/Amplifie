/**
 * Счётчик согласия для арбитра К2 (Р-004).
 *
 * ПОЧЕМУ КАППА, А НЕ ДОЛЯ СОВПАДЕНИЙ. Договорённости в переписке редки.
 * На корпусе, где их 15%, разметчик, всегда отвечающий «болтовня», получит
 * 85% совпадений и будет выглядеть хорошим. Каппа вычитает то, что дало бы
 * простое угадывание, и такой разметчик получает ноль.
 *
 * ПОЧЕМУ ВОЗВРАЩАЕТСЯ null, А НЕ ЧИСЛО. Есть случаи, где каппа не определена
 * (все ответы одного класса). Вернуть там 1 — соврать: корпус, в котором
 * все ответы одинаковы, ничего не различает. Отказ честнее.
 */

export const AGREEMENT = "agreement";
export const CHATTER = "chatter";
export const LABELS = [AGREEMENT, CHATTER];

/** Доля строк, где выполняется условие. */
function share(rows, predicate) {
  return rows.filter(predicate).length / rows.length;
}

/**
 * Каппа Коэна между двумя разметками. null — если не определена.
 *
 * @param {{a: string, b: string}[]} rows
 * @returns {number | null}
 */
export function cohenKappa(rows) {
  if (rows.length === 0) return null;

  const observed = share(rows, (r) => r.a === r.b);

  // Ожидаемое случайное совпадение: сумма по классам произведений долей.
  let expected = 0;
  for (const label of LABELS) {
    expected += share(rows, (r) => r.a === label) * share(rows, (r) => r.b === label);
  }

  // Оба разметчика ответили одинаково на всё: делить не на что.
  if (expected === 1) return null;

  return (observed - expected) / (1 - expected);
}

/**
 * Точность и полнота агента — ТОЛЬКО по строкам, где разметчики сошлись.
 *
 * Спорное исключается намеренно (Р-004): требовать от агента угадать то,
 * о чём не договорились люди, — мерить шум. Число спорных возвращается
 * отдельно, потому что оно и есть самое интересное в корпусе.
 *
 * @param {{a: string, b: string, agent?: string}[]} rows
 */
export function scoreAgainst(rows) {
  const settled = rows.filter((r) => r.a === r.b);
  const disputed = rows.length - settled.length;
  const scored = settled.filter((r) => r.agent === AGREEMENT || r.agent === CHATTER);

  const truePositive = scored.filter((r) => r.a === AGREEMENT && r.agent === AGREEMENT).length;
  const said = scored.filter((r) => r.agent === AGREEMENT).length;
  const real = scored.filter((r) => r.a === AGREEMENT).length;

  return {
    counted: scored.length,
    disputed,
    unlabelled: settled.length - scored.length,
    truePositive,
    // Агент не сказал «да» ни разу: точность не определена, а не идеальна.
    precision: said === 0 ? null : truePositive / said,
    recall: real === 0 ? null : truePositive / real,
    agentKappa: cohenKappa(scored.map((r) => ({ a: r.a, b: r.agent }))),
  };
}

/** Каппа между разметчиками — потолок, выше которого агенту некуда. */
export function ceiling(rows) {
  return cohenKappa(rows.filter((r) => r.a && r.b));
}
