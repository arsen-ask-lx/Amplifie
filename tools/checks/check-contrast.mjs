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
 * ГДЕ ЖИВУТ ЗНАЧЕНИЯ. В frontend/src/styles.css, по правилу проекта.
 * Здесь только ПАРЫ: что на чём лежит. Пара — это факт замысла, его
 * из CSS не вывести, поэтому он объявлен явно и один раз.
 *
 * ЧТО ИЗМЕНИЛОСЬ С Р-014. Проверяются две вещи, а не одна:
 *   ① ПРАВИЛА ШКАЛЫ — 11-я и 12-я ступени читаются на 1–3, 9-я и 10-я
 *      держат границу. Это переживает смену значений: подставил другую
 *      палитру — правило то же;
 *   ② ПАРЫ РОЛЕЙ — что на чём лежит на самом деле. Роль это псевдоним
 *      ступени (`--ink: var(--n12)`), поэтому ссылки разворачиваются.
 *
 * Одних правил шкалы мало: ошибиться можно и назначением роли — взять
 * на границу ступень 8 вместо 10. Одних пар мало: они не заметят, что
 * сама шкала испортилась там, куда пара не смотрит.
 */
import { readFileSync } from "node:fs";

const CSS = "frontend/src/styles.css";

/** Порог WCAG AA: текст 4.5:1, крупный текст и границы элементов 3:1. */
const TEXT = 4.5;
const EDGE = 3;

/**
 * Правила шкалы. Проверяются в обеих шкалах — нейтральной и акцентной.
 *
 * Пороги WCAG, а не APCA: у нас порог 4.5:1 записан в правиле проекта
 * и в Р-005. Radix считает свои ступени по APCA, поэтому совпадение
 * не гарантировано — и именно поэтому проверяем сами, а не верим.
 */
const SCALES = [
  {
    prefix: "--n",
    what: "нейтральная",
    rules: [
      { fg: 12, on: [1, 2, 3], need: TEXT, what: "основной текст" },
      { fg: 11, on: [1, 2, 3], need: TEXT, what: "приглушённый текст" },
      { fg: 10, on: [1, 2], need: EDGE, what: "ступень границы" },
    ],
  },
  {
    // У акцентной шкалы проверяется только текстовая ступень. 11-я
    // на своём фоне даёт 4.19–4.43 — Radix считает ступени по APCA,
    // а у нас порог WCAG, и совпадения нет. Поэтому текстом служит 12-я,
    // а 11-я используется только там, где под ней тёмный фон. Это поймал
    // сам гейт на первом же прогоне.
    prefix: "--a",
    what: "акцентная",
    rules: [{ fg: 12, on: [1, 2, 3], need: TEXT, what: "текстовая ступень" }],
  },
];

/** Что на чём лежит. Изменил замысел — правь здесь, иначе гейт врёт. */
const PAIRS = [
  { fg: "--ink", bg: "--bg", need: TEXT, what: "основной текст на фоне" },
  { fg: "--ink", bg: "--panel", need: TEXT, what: "основной текст на панели" },
  { fg: "--ink", bg: "--raised", need: TEXT, what: "текст на наведённом" },
  { fg: "--ink", bg: "--selected", need: TEXT, what: "текст на выбранном" },
  { fg: "--muted", bg: "--bg", need: TEXT, what: "приглушённый текст на фоне" },
  { fg: "--muted", bg: "--panel", need: TEXT, what: "приглушённый текст на панели" },
  { fg: "--muted", bg: "--raised", need: TEXT, what: "подпись цитаты на цитате" },
  { fg: "--danger", bg: "--bg", need: TEXT, what: "текст ошибки" },
  { fg: "--danger", bg: "--panel", need: TEXT, what: "текст ошибки на панели" },
  { fg: "--on-accent", bg: "--accent", need: TEXT, what: "текст на акценте" },
  { fg: "--ink", bg: "--accent-soft", need: TEXT, what: "текст в своём пузыре" },
  { fg: "--muted-on-soft", bg: "--accent-soft", need: TEXT, what: "время в своём пузыре" },
  { fg: "--ink", bg: "--panel", need: TEXT, what: "текст в чужом пузыре" },
  { fg: "--accent-ink", bg: "--panel", need: TEXT, what: "имя автора в чужом пузыре" },
  { fg: "--accent-ink", bg: "--bg", need: TEXT, what: "акцент как текст на фоне" },
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
  for (const line of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    found[line[1]] = line[2].trim();
  }
  return found;
}

/**
 * Развернуть ссылки `var(--x)` до цвета.
 *
 * Роли объявлены псевдонимами ступеней — иначе значение пришлось бы
 * повторять дважды, и при первой же правке темы разъехались бы.
 * Ограничение по глубине: кольцо ссылок иначе повесило бы гейт.
 */
function resolve(raw, table, depth = 0) {
  if (raw === undefined || depth > 8) return null;
  const link = /^var\(\s*(--[a-z0-9-]+)\s*\)$/iu.exec(raw);
  if (link) return resolve(table[link[1]], table, depth + 1);
  const rgb = parseHex(raw);
  return rgb ? { hex: raw, rgb } : null;
}

/** Таблица «имя → цвет» одной темы, со всеми развёрнутыми ссылками. */
function paletteOf(table) {
  const out = {};
  for (const name of Object.keys(table)) {
    const colour = resolve(table[name], table);
    if (colour) out[name] = colour;
  }
  return out;
}

const css = readFileSync(CSS, "utf8");

/**
 * Блоков объявлений теперь несколько: шкала и роли объявлены раздельно.
 * Собираем все, иначе роль ссылалась бы на ступень, которой «нет».
 */
function allBlocks(source, pattern) {
  const table = {};
  for (const block of source.matchAll(pattern)) Object.assign(table, varsIn(block[1]));
  return table;
}

/**
 * Вырезать всё внутри @media.
 *
 * Без этого в светлую тему затекают значения тёмной: `:root` объявлен
 * и там, и там. Поймано первым же прогоном гейта — он сообщил о нарушении
 * в светлой теме, показав тёмные значения.
 */
/** Конец блока в фигурных скобках, начиная от позиции `from`. -1 — не закрыт. */
function blockEnd(source, from) {
  const opened = source.indexOf("{", from);
  if (opened < 0) return -1;
  let depth = 0;
  for (let cursor = opened; cursor < source.length; cursor++) {
    if (source[cursor] === "{") depth++;
    else if (source[cursor] === "}" && --depth === 0) return cursor;
  }
  return -1;
}

/** Блоки тёмной темы не должны попасть в светлую: она — значения по умолчанию. */
function withoutDark(source) {
  return source.replaceAll(/:root\[data-theme="dark"\]\s*\{[^{}]*\}/gu, "");
}

function withoutMedia(source) {
  let out = "";
  let at = 0;
  for (;;) {
    const start = source.indexOf("@media", at);
    if (start < 0) return out + source.slice(at);
    out += source.slice(at, start);
    const end = blockEnd(source, start);
    if (end < 0) return out;
    at = end + 1;
  }
}

const rawLight = allBlocks(withoutDark(withoutMedia(css)), /:root\s*\{([^{}]*)\}/gu);
// В тёмной теме переопределены не все переменные — остальные наследуются.
const rawDark = {
  ...rawLight,
  ...allBlocks(css, /:root\[data-theme="dark"\]\s*\{([^{}]*)\}/gu),
};

const light = paletteOf(rawLight);
const dark = paletteOf(rawDark);

const problems = [];
let checked = 0;

/** Одно правило шкалы на одной ступени-подложке. Возвращает жалобу или null. */
function scaleProblem(theme, scale, rule, step, palette) {
  const fg = palette[`${scale.prefix}${rule.fg}`];
  const bg = palette[`${scale.prefix}${step}`];
  if (!fg || !bg) {
    return (
      `${theme}: в ${scale.what} шкале нет ступени ${fg ? step : rule.fg}.
` +
      `  ПОЧИНИТЬ: объяви ${scale.prefix}1…${scale.prefix}12 целиком.
` +
      "  Неполная шкала — это дыра, о которой никто не узнает."
    );
  }
  checked++;
  const got = ratio(fg.rgb, bg.rgb);
  if (got >= rule.need) return null;
  return (
    `${theme}: ${scale.what} шкала, ${rule.what} — ${got.toFixed(2)}:1, нужно ${rule.need}:1
` +
    `  ${scale.prefix}${rule.fg} (${fg.hex}) на ${scale.prefix}${step} (${bg.hex})
` +
    "  ПОЧИНИТЬ: ступень взята не из согласованной шкалы либо правлена по месту.\n" +
    "  Правь шкалу, а не роль: роль — псевдоним, и правка по месту вернётся."
  );
}

for (const [theme, palette] of [
  ["светлая", light],
  ["тёмная", dark],
]) {
  // ① правила шкалы
  for (const scale of SCALES) {
    for (const rule of scale.rules) {
      for (const step of rule.on) {
        const problem = scaleProblem(theme, scale, rule, step, palette);
        if (problem) problems.push(problem);
      }
    }
  }

  // ② пары ролей
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
