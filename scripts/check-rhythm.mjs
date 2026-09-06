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
 */
import { readFileSync } from "node:fs";

const CSS = "apps/web/src/styles.css";

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

if (problems.length > 0) {
  console.error(`\nРитм нарушен: ${problems.length} значений из ${checked}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

console.log(`ритм: ${checked} значений отступов, все кратны ${STEP} — OK`);
