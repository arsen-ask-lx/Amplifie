#!/usr/bin/env node
/**
 * Гейт ритма: отступы стоят на сетке.
 *
 * ЗАЧЕМ. Отступы, взятые «на глаз», глаз и замечает — но не может назвать
 * причину. Тринадцать пикселей здесь, семь там, девять рядом: каждое
 * значение по отдельности выглядит нормально, вместе — как небрежность.
 * Это одна из трёх счётных причин, по которым интерфейс читался дешёвым
 * (Р-014).
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Только внешние и внутренние отступы, зазоры и
 * скругления. Кратность шагу в 4 пикселя.
 *
 * ЧТО НЕ ПРОВЕРЯЕТСЯ И ПОЧЕМУ:
 *   • размеры шрифта и высота строк — у них своя шкала, к сетке отступов
 *     они отношения не имеют;
 *   • ширины, высоты и предельные размеры — там числа диктует содержимое
 *     (46 знаков в строке, 28 пикселей кружка);
 *   • единица, кроме `px` — проценты, `em`, `rem`, `dvh` и `var()` живут
 *     не в этой системе счёта;
 *   • 1, 2 и 3 пикселя — толщина границ и оптические поправки к ним.
 *     Порог начинается с 4: всё, что меньше шага, шагом и не мерится.
 *
 * ЧТО ДОБАВИЛОСЬ С TAILWIND (task-013). Именованные классы — `p-3`, `gap-2` —
 * НЕ проверяются, и это не пробел: у Tailwind весь размерный ряд кратен
 * одной переменной `--spacing`, а она объявлена нашими 4px. `p-3` — это
 * 12px и другим быть не может. Правило там не проверка, а свойство
 * конструкции.
 *
 * ⚠️ Пробить его можно ровно одним способом — произвольным значением
 * в скобках: `p-[13px]`. Вот их гейт и ищет в разметке. Без этого он
 * ослеп бы ровно в тот день, когда вид переехал из CSS в классы (Р-015:
 * гейт, которому нечего смотреть, тоже зелёный).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS = "frontend/src/styles.css";

/** Разметка: с task-013 отступы живут ещё и в классах Tailwind. */
const MARKUP = "frontend/src";

/** Шаг сетки. Совпадает с `--step` в стилях. */
const STEP = 4;

/** Меньше шага — это уже не отступ, а толщина линии. */
const HAIRLINE = 3;

/**
 * Скругление больше этого — «пилюля»: половина высоты, а не размер.
 * `border-radius: 999px` не подгоняется под сетку, потому что вообще
 * не про сетку: это способ сказать «скругли до упора».
 */
const PILL = 64;

/** Свойства, которые обязаны стоять на сетке. */
const SPACING = /^(margin|padding|gap|inset|top|right|bottom|left|border-radius)(-[a-z]+)*$/u;

/** Годное ли значение. Вынесено, чтобы правило читалось одной строкой. */
function onGrid(property, size) {
  if (size <= HAIRLINE) return true;
  if (size % STEP === 0) return true;
  return property === "border-radius" && size >= PILL;
}

const problems = [];
let checked = 0;

const lines = readFileSync(CSS, "utf8").split(/\r?\n/u);

lines.forEach((line, index) => {
  const declaration = /^\s*([a-z-]+)\s*:\s*([^;]+);/u.exec(line);
  if (!declaration) return;

  const [, property, value] = declaration;
  if (!SPACING.test(property ?? "")) return;

  for (const found of (value ?? "").matchAll(/(-?\d+(?:\.\d+)?)px/gu)) {
    const size = Math.abs(Number(found[1]));
    checked++;
    if (onGrid(property, size)) continue;
    problems.push(
      `${CSS}:${index + 1}: ${property}: ${found[0]} — не кратно ${STEP}\n` +
        `  ${line.trim()}\n` +
        `  ПОЧИНИТЬ: ближайшие годные — ${Math.floor(size / STEP) * STEP} или ` +
        `${Math.ceil(size / STEP) * STEP}.\n` +
        "  Не подгоняй сетку под один экран: разъедется весь остальной.",
    );
  }
});

/** Произвольное значение в классе: `p-[13px]`, `gap-[7px]`, `rounded-[9px]`. */
const ARBITRARY =
  /\b(m|p|gap|inset|top|right|bottom|left|rounded)([a-z]*)-\[(-?\d+(?:\.\d+)?)px\]/gu;

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/u.test(name)) found.push(path);
  }
  return found;
}

let scanned = 0;
for (const path of filesUnder(MARKUP)) {
  scanned++;
  readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .forEach((line, index) => {
      for (const found of line.matchAll(ARBITRARY)) {
        const kind = found[1] === "rounded" ? "border-radius" : "padding";
        const size = Math.abs(Number(found[3]));
        checked++;
        if (onGrid(kind, size)) continue;
        problems.push(
          `${path}:${index + 1}: ${found[0]} — не кратно ${STEP}\n` +
            `  ${line.trim().slice(0, 90)}\n` +
            `  ПОЧИНИТЬ: возьми класс из ряда — ближайшие годные ` +
            `${Math.floor(size / STEP) * STEP}px и ${Math.ceil(size / STEP) * STEP}px.\n` +
            "  Значение в скобках — единственный способ пробить сетку Tailwind,\n" +
            "  и потому единственное, что здесь проверяется.",
        );
      }
    });
}

if (problems.length > 0) {
  console.error(`\nРитм нарушен: ${problems.length} значений из ${checked}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

/**
 * Числа важнее вердикта (Р-015) — но считать надо ТО, ЧТО ЕСТЬ.
 *
 * ⚠️ ЭТОТ ПОРОГ УЖЕ ОДИН РАЗ СОВРАЛ, И ЭТО ПОУЧИТЕЛЬНО. Он требовал
 * «проверено не меньше 50 значений» и был верен, пока отступы жили
 * в CSS. После переезда на Tailwind (task-013) их там не осталось:
 * гейт покраснел на здоровом коде, потому что мерил исчезнувшую
 * величину.
 *
 * Считаемое сменилось вместе с предметом. Значений в скобках у здорового
 * кода СТОЛЬКО И ДОЛЖНО БЫТЬ — ноль: именованный класс Tailwind стоит
 * на сетке по построению. Признак «обход состоялся» теперь один —
 * сколько файлов разметки прочитано.
 */
const FILES_FLOOR = 15;
if (scanned < FILES_FLOOR) {
  console.error(
    `
ритм: прочитано всего ${scanned} файлов разметки в ${MARKUP} — обход не состоялся
`,
  );
  process.exit(1);
}

console.log(
  `ритм: ${scanned} файлов разметки, ${checked} значений в пикселях, все кратны ${STEP} — OK`,
);
