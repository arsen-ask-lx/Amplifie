/**
 * «Не пусто» вместо значения — правило (task-125).
 *
 * ЗАЧЕМ. AGENTS.md запрещает «не пусто» вместо точного результата с сентября, а ревизия
 * 27.09 нашла десятки таких мест: правило без сторожа. `expect(fields.password)
 * .toBeTruthy()` пройдёт и на неверном тексте ошибки — проверено ничего.
 *
 * ⚠️ СТОРОЖ ПЕРЕД ТОЧНОЙ ПРОВЕРКОЙ — ЗАКОННО. `expect(x).toBeDefined(); expect(x.a).toBe(1)`
 * — обычный способ сузить тип. Находка — только если в этом же тесте нет ТОЧНОЙ проверки
 * того же значения; точная — из белого списка и без `not.` (`not.toBe(5)` и
 * `toBeGreaterThan(0)` ничего не доказывают — ревью шага 2).
 *
 * ⚠️ РАЗБОР ВСЕГО ТЕКСТА, А НЕ ПО СТРОКЕ, СТРОКИ И КОММЕНТАРИИ ЗАМАСКИРОВАНЫ. Форматтер
 * переносит длинный `expect(…)` и цепочку на новые строки; построчный разбор их терял.
 * Маска — заглушка той же длины с сохранёнными переводами строк: позиции и номера строк
 * те же, а образцы в кавычках (в том числе в тестах самого правила) — не код.
 *
 * ⚠️ ГРАНИЦА ТЕСТА — ПО СКОБКАМ. Сторожа оправдывает точная проверка до конца блока, в
 * котором он стоит (закрылась объемлющая скобка): вложенная функция тест не закрывает,
 * помощник ниже теста — уже вне его (третий круг ревью).
 *
 * Пределы (названы, разбора языка нет): литерал регулярного выражения не маскируется —
 * `//`, `` ` `` или пара `"` внутри `/…/` сбивают разбор строки; вызов внутри `${…}`
 * шаблонной строки не виден; `assert.ok(…)` из `node:test` не ловится — в оснастке это
 * обычно условие, а не «не пусто».
 *
 * Чистая функция: текст файла на входе, находки на выходе.
 */

const CALL = /(?<![\w.$])expect(?:\.soft|\.poll)?\(/gu;
const TAIL = /^\s*\.\s*(?:(?:resolves|rejects)\s*\.\s*)?(not\s*\.\s*)?(\w+)\s*\(([^)]*)\)/u;
const EXACT = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toMatchObject",
  "toHaveLength",
  "toContain",
  "toContainEqual",
  "toMatch",
]);
const WEAK_ALWAYS = new Set(["toBeTruthy", "toBeDefined", "toBeFalsy"]);
const WEAK_NEGATED = new Set(["toBeNull", "toBeUndefined"]);

/**
 * Строки — заглушкой `_`, комментарии — пробелами (той же длины, переводы строк остаются):
 * комментарий между вызовом и `.toBeTruthy()` тогда просто пробел.
 */
function mask(text) {
  return text.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gu,
    (one) => one.replace(/[^\n]/gu, one.startsWith("/") ? " " : "_"),
  );
}

/** Где кончается блок, в котором стоит позиция `from`: закрылась объемлющая скобка. */
function blockEnd(masked, from) {
  let depth = 0;
  for (let at = from; at < masked.length; at += 1) {
    if ("([{".includes(masked[at])) depth += 1;
    else if (")]}".includes(masked[at])) depth -= 1;
    if (depth < 0) return at;
  }
  return masked.length;
}

/** Где закрывается скобка, открытая в `open` (в замаскированном тексте), — или -1. */
function closingParen(masked, open) {
  let depth = 0;
  for (let at = open; at < masked.length; at += 1) {
    if (masked[at] === "(") depth += 1;
    else if (masked[at] === ")") depth -= 1;
    if (depth === 0) return at;
  }
  return -1;
}

/** Первый аргумент: `expect(x, "сообщение")` проверяет `x`; запятая в скобках — не граница. */
function firstArg(args, maskedArgs) {
  let depth = 0;
  for (let at = 0; at < maskedArgs.length; at += 1) {
    if ("([{".includes(maskedArgs[at])) depth += 1;
    else if (")]}".includes(maskedArgs[at])) depth -= 1;
    else if (maskedArgs[at] === "," && depth === 0) return args.slice(0, at).trim();
  }
  return args.trim();
}

/** Слабая ли проверка: «не пусто» в любой записи. */
function isWeak({ negated, matcher, args }) {
  if (!negated) return WEAK_ALWAYS.has(matcher);
  if (WEAK_NEGATED.has(matcher)) return true;
  if (matcher === "toBe") return /^\s*(null|undefined)\s*$/u.test(args);
  return matcher === "toHaveLength" && args.trim() === "0";
}

/** Вызовы `expect(…).…(…)`: начало, конец, значение и сама проверка. */
function calls(text, masked) {
  const found = [];
  for (const hit of masked.matchAll(CALL)) {
    const open = hit.index + hit[0].length - 1;
    const close = closingParen(masked, open);
    const tail = close < 0 ? null : TAIL.exec(masked.slice(close + 1));
    if (!tail) continue;
    found.push({
      start: hit.index,
      end: close + 1 + tail[0].length,
      subject: firstArg(text.slice(open + 1, close), masked.slice(open + 1, close)),
      negated: Boolean(tail[1]),
      matcher: tail[2],
      args: tail[3],
    });
  }
  return found;
}

/** `!` снимается только как постфикс (`x!.a`), а не внутри строк и `!==`. */
const plain = (subject) => subject.replace(/!(?=[.?[]|$)/gu, "");
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Точная проверка того же значения: `x`, `x.a`, `x?.a`, `x!.a`, `x[0]`. */
function checksSame(subject, call) {
  if (call.negated || !EXACT.has(call.matcher)) return false;
  const base = plain(subject);
  const other = plain(call.subject);
  return other === base || new RegExp(`^${literal(base)}[.?[]`, "u").test(other);
}

/**
 * Находки: `{ line, text }` — номер строки начала (с 1) и сам вызов, сжатый в одну строку.
 * Текст — ключ храповика: строка многострочного вызова была бы просто «expect(».
 */
export function weakAsserts(text) {
  const masked = mask(text);
  const all = calls(text, masked);
  return all
    .filter((weak) => isWeak(weak))
    .filter((weak) => {
      const stop = blockEnd(masked, weak.start);
      return !all.some(
        (one) => one.start >= weak.end && one.start < stop && checksSame(weak.subject, one),
      );
    })
    .map((weak) => ({
      line: text.slice(0, weak.start).split("\n").length,
      text: text.slice(weak.start, weak.end).replace(/\s+/gu, " ").trim(),
    }));
}
