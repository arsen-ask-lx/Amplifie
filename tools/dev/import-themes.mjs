#!/usr/bin/env node
/**
 * Перенос тем из audit_project.
 *
 * ⚠️ ОДНОРАЗОВЫЙ ПЕРЕНОСЧИК, А НЕ ЧАСТЬ СБОРКИ. Он читает чужой файл
 * с чужой машины и печатает наш CSS в стандартный вывод. Значения после
 * этого живут у нас числами — по правилу проекта, — и чужой проект
 * перестаёт быть зависимостью. Держать это в сборке значило бы завести
 * связь с каталогом, которого на другой машине нет.
 *
 * ЧТО ПЕРЕНОСИТСЯ. Только тринадцать общих ролей. Всё остальное в том
 * файле — про их предметную область (договоры, табели, стадии аудита),
 * и у нас ему нечего означать.
 *
 * Запуск:
 *   node tools/dev/import-themes.mjs <путь к site-theme.tokens.css> > frontend/src/themes.css
 */
import { readFileSync } from "node:fs";

const source = readFileSync(process.argv[2], "utf8");

/** `220 13% 10%` → #rrggbb. Их значения записаны тройками HSL без функции. */
function hslToHex(triplet) {
  const [h, s, l] = triplet
    .trim()
    .split(/\s+/u)
    .map((part) => Number.parseFloat(part));
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;

  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const sixth = Math.floor(h / 60) % 6;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sixth].map((part) => Math.round((part + m) * 255));

  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** #rrggbb → [r,g,b] и обратно. */
function toRgb(hex) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}
function toHex(rgb) {
  return `#${rgb
    .map((n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function luminance([r, g, b]) {
  const channel = (raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Довести цвет до порога, двигая его от фона.
 *
 * ⚠️ ЧУЖИЕ ТЕМЫ ПЕРЕНОСЯТСЯ НЕ КАК ЕСТЬ. У них тонкие границы полей
 * дают 1.36:1 вместо трёх, а тихий текст на своём пузыре — 3.67 вместо
 * четырёх с половиной. Это их выбор вида; наш порог записан в правиле
 * проекта, и принести чужую нечитаемость вместе с чужой красотой значит
 * обменять первое на второе молча.
 *
 * Двигаем ТОЛЬКО передний план и только в ту сторону, где становится
 * лучше: фон темы остаётся её фоном, оттенок сохраняется, меняется
 * светлота. Не сошлось за сто шагов — отдаём чёрный или белый: это
 * заметно и чинится глазами, а тихая недостача — нет.
 */
function reach(fgHex, bgHex, need) {
  let fg = toRgb(fgHex);
  const bg = toRgb(bgHex);
  if (ratio(fg, bg) >= need) return fgHex;

  const toward = luminance(bg) > 0.5 ? 0 : 255;
  for (let step = 0; step < 100; step++) {
    fg = fg.map((part) => part + (toward - part) * 0.04);
    if (ratio(fg, bg) >= need) return toHex(fg);
  }
  return toward === 0 ? "#000000" : "#ffffff";
}

/**
 * Пары, которые обязаны сойтись. Те же, что проверяет `make contrast`, —
 * иначе перенос отдаст гейту работу, которую мог сделать сам.
 */
const MUST = [
  ["--ink", ["--bg", "--panel", "--raised", "--selected", "--card"], 4.5],
  ["--muted", ["--bg", "--panel", "--raised"], 4.5],
  ["--danger", ["--bg", "--panel"], 4.5],
  ["--on-accent", ["--accent"], 4.5],
  ["--ink-on-soft", ["--accent-soft"], 4.5],
  ["--muted-on-soft", ["--accent-soft"], 4.5],
  ["--accent-ink", ["--panel", "--bg"], 4.5],
  ["--accent", ["--bg"], 3],
  ["--edge", ["--bg", "--panel"], 3],
];

/** Наши роли ← их имена. Слева наше, справа чужое. */
const ROLES = [
  ["--bg", "background"],
  ["--card", "card"],
  ["--panel", "popover"],
  ["--raised", "muted"],
  ["--selected", "accent"],
  ["--ink", "foreground"],
  ["--muted", "muted-foreground"],
  ["--line", "border"],
  ["--edge", "input"],
  ["--accent", "primary"],
  ["--on-accent", "primary-foreground"],
  ["--accent-soft", "secondary"],
  ["--accent-soft-edge", "border"],
  ["--ink-on-soft", "secondary-foreground"],
  ["--muted-on-soft", "muted-foreground"],
  ["--accent-ink", "primary"],
  ["--danger", "destructive"],
  ["--on-danger", "destructive-foreground"],
];

/** Русские имена: тема выбирается человеком, а не разработчиком. */
const NAMES = {
  "dark-corporate": "корпоративная",
  "dark-oceanic": "океан",
  "light-gray": "серая",
  "light-excel": "таблица",
  "light-gold": "золото",
  "dark-github": "гитхаб тёмный",
  "dark-oxocarbon": "оксокарбон",
  "light-porcelain": "фарфор",
  "light-slate-notion": "сланец",
  "light-github": "гитхаб светлый",
  "dark-samurai": "самурай",
  "dark-nightcity": "ночной город",
};

const blocks = source.matchAll(/html\.site-theme-([a-z-]+)\s*\{([\s\S]*?)\n\}/gu);
const out = [];

for (const [, slug, body] of blocks) {
  const name = NAMES[slug];
  if (!name) continue;

  const theirs = {};
  for (const line of body.matchAll(/--([a-z-]+):\s*([0-9.]+\s+[0-9.]+%\s+[0-9.]+%)\s*;/gu)) {
    theirs[line[1]] = line[2];
  }

  const role = {};
  for (const [ours, theirName] of ROLES) {
    const hex = theirs[theirName] ? hslToHex(theirs[theirName]) : null;
    if (hex) role[ours] = hex;
  }
  if (Object.keys(role).length < 10) continue;

  /**
   * Текст на акценте выбирается ЧЁРНЫМ ИЛИ БЕЛЫМ, а не двигается.
   *
   * Акцент — самый насыщенный цвет темы, и подпись на нём бывает только
   * двух видов; тянуть её к порогу постепенно значит получить грязный
   * серо-жёлтый там, где нужен либо чёрный, либо белый. Берём тот,
   * что читается лучше, — так поступает любой набор компонентов.
   */
  if (role["--accent"]) {
    const on = toRgb(role["--accent"]);
    role["--on-accent"] =
      ratio(on, [0, 0, 0]) >= ratio(on, [255, 255, 255]) ? "#000000" : "#ffffff";
  }

  /**
   * ⚠️ ПОВЕРХНОСТИ ДВИГАЮТСЯ РАНЬШЕ ТЕКСТА. Наведённое и выбранное — это
   * ФОН под обычным текстом; если тянуть к порогу текст, он разъедется
   * с текстом на соседних поверхностях, и тема потеряет единство.
   * Двигаем подложку — её на экране меньше и она для того и есть.
   */
  for (const bg of ["--raised", "--selected"]) {
    if (role[bg] && role["--ink"]) role[bg] = reach(role[bg], role["--ink"], 4.5);
  }

  // Порог доводится ДО записи: тема попадает к нам уже читаемой.
  for (const [fg, backgrounds, need] of MUST) {
    for (const bg of backgrounds) {
      if (role[fg] && role[bg]) role[fg] = reach(role[fg], role[bg], need);
    }
  }

  const lines = Object.entries(role).map(([key, value]) => `  ${key}: ${value};`);
  // ⚠️ ДВА СЕЛЕКТОРА, И КАЖДЫЙ ПО ДЕЛУ.
  //
  // `:root[data-theme=…]` весит больше, чем голый `:root` с монохромом,
  // и перебивает его независимо от порядка файлов — а порядок задаёт
  // `@import`, который обязан стоять первым в CSS.
  //
  // `[data-theme=…]` без корня нужен образцам в меню: там атрибут висит
  // на самом кружке, и правило, попавшее в элемент, всегда сильнее
  // унаследованного. Без него рядом со списком тем пришлось бы держать
  // вторую копию цветов.
  const scheme = slug.startsWith("dark") ? "dark" : "light";
  out.push(
    `:root[data-theme="${name}"],\n[data-theme="${name}"] {\n${lines.join("\n")}\n  color-scheme: ${scheme};\n}`,
  );
}

console.log(out.join("\n\n"));
