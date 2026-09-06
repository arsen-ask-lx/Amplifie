#!/usr/bin/env node
/**
 * Гейт контраста интерфейса.
 *
 * ЗАЧЕМ. Р-005 честно признаёт: ни одно ограничение вида машиной не
 * проверяется, и называет это открытым долгом. Из трёх механизмов, которые
 * действительно останавливают плохой результат, исполняемый проверяльщик
 * контраста — единственный, который можно завести прямо сейчас.
 *
 * ЧТО ОН НЕ ДЕЛАЕТ. Не судит о вкусе. «Акцент в трёх ролях» и «структура
 * кодирует смысл» он отличить не умеет, и притворяться не будет. Он считает
 * ровно одно число — и считает его точно.
 *
 * ГДЕ ЖИВУТ ЗНАЧЕНИЯ. В apps/web/src/styles.css, по правилу проекта.
 * Здесь только ПАРЫ: что на чём лежит. Пара — это факт замысла, его
 * из CSS не вывести, поэтому он объявлен явно и один раз.
 */
import { readFileSync } from "node:fs";

const CSS = "apps/web/src/styles.css";

/** Порог WCAG AA: текст 4.5:1, крупный текст и границы элементов 3:1. */
const TEXT = 4.5;
const EDGE = 3;

/** Что на чём лежит. Изменил замысел — правь здесь, иначе гейт врёт. */
const PAIRS = [
  { fg: "--ink", bg: "--bg", need: TEXT, what: "основной текст на фоне" },
  { fg: "--ink", bg: "--panel", need: TEXT, what: "основной текст на панели" },
  { fg: "--ink", bg: "--raised", need: TEXT, what: "текст на наведённом" },
  { fg: "--ink", bg: "--selected", need: TEXT, what: "текст на выбранном" },
  { fg: "--muted", bg: "--bg", need: TEXT, what: "приглушённый текст на фоне" },
  { fg: "--muted", bg: "--panel", need: TEXT, what: "приглушённый текст на панели" },
  { fg: "--danger", bg: "--bg", need: TEXT, what: "текст ошибки" },
  { fg: "--danger", bg: "--panel", need: TEXT, what: "текст ошибки на панели" },
  { fg: "--on-accent", bg: "--accent", need: TEXT, what: "текст на акценте" },
  { fg: "--accent", bg: "--bg", need: EDGE, what: "акцент как граница на фоне" },
  { fg: "--edge", bg: "--bg", need: EDGE, what: "граница поля ввода на фоне" },
  { fg: "--edge", bg: "--panel", need: EDGE, what: "граница поля ввода на панели" },
];

// --line НЕ проверяется намеренно. Правило требует 3:1 от границ
// ИНТЕРАКТИВНЫХ элементов; разделитель между блоками интерактивным
// не является, и порог 3:1 превратил бы интерфейс в таблицу.
// Для полей и кнопок заведена отдельная переменная --edge.

/** #rgb или #rrggbb → [r, g, b]. Другие записи цвета намеренно не понимаем. */
function parseHex(value) {
  const hex = value.trim().replace(/^#/u, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/iu.test(full)) return null;
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16));
}

/** Относительная яркость по WCAG 2.x. */
function luminance([r, g, b]) {
  const channel = (raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Переменные из одного блока объявлений.
 *
 * Тема берётся куском текста, а не разбором CSS целиком: разбирать CSS ради
 * дюжины переменных — заводить зависимость там, где хватает одной регулярки.
 */
function varsIn(block) {
  const found = {};
  for (const line of block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/giu)) {
    const colour = parseHex(line[2]);
    if (colour) found[line[1]] = { hex: line[2].trim(), rgb: colour };
  }
  return found;
}

const css = readFileSync(CSS, "utf8");

/** Светлая тема — первый :root. Тёмная — :root внутри prefers-color-scheme. */
const lightBlock = /:root\s*\{([\s\S]*?)\}/u.exec(css)?.[1] ?? "";
const darkBlock =
  /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/u.exec(css)?.[1] ?? "";

const light = varsIn(lightBlock);
// В тёмной теме переопределены не все переменные — остальные наследуются.
const dark = { ...light, ...varsIn(darkBlock) };

const problems = [];
let checked = 0;

for (const [theme, palette] of [
  ["светлая", light],
  ["тёмная", dark],
]) {
  for (const pair of PAIRS) {
    const fg = palette[pair.fg];
    const bg = palette[pair.bg];
    if (!fg || !bg) {
      problems.push(
        `${theme}: нет переменной ${fg ? pair.bg : pair.fg} — пара «${pair.what}» не проверена.\n` +
          `  ПОЧИНИТЬ: объяви её в ${CSS} либо убери пару из scripts/check-contrast.mjs.\n` +
          "  Непроверенная пара опаснее низкого контраста: о ней не знают.",
      );
      continue;
    }
    checked++;
    const got = ratio(fg.rgb, bg.rgb);
    if (got >= pair.need) continue;
    problems.push(
      `${theme}: ${pair.what} — ${got.toFixed(2)}:1, нужно ${pair.need}:1\n` +
        `  ${pair.fg} (${fg.hex}) на ${pair.bg} (${bg.hex})\n` +
        "  ПОЧИНИТЬ: сдвинь одно из двух значений, пока число не дойдёт до порога.\n" +
        "  Порог не понижается: он не про вкус, а про читаемость.",
    );
  }
}

if (problems.length > 0) {
  console.error(`\nКонтраст не проходит: ${problems.length} пар из ${checked + problems.length}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  process.exit(1);
}

console.log(`контраст: ${checked} пар в двух темах — OK`);
