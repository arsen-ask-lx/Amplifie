#!/usr/bin/env node
/**
 * Растровые значки вкладки из нашего SVG.
 *
 * ЗАЧЕМ ОНИ, ЕСЛИ ЕСТЬ SVG. Значок в SVG понимают все браузеры, которые
 * мы поддерживаем, — но «понимают» и «показывают в этой вкладке прямо
 * сейчас» оказались разными вещами: владелец не видел наш знак, хотя
 * сервер отдавал его с кодом 200. Растр — то, что понимает вообще всё,
 * включая закладки, ярлыки на рабочем столе и плитку на телефоне.
 *
 * ⚠️ ЭТО НЕ ВТОРОЙ ИСТОЧНИК ПРАВДЫ. Картинки СОБИРАЮТСЯ из того же
 * `favicon.svg`, который сторожит `make favicon`. Правишь знак —
 * гоняешь `make icons`, и растр догоняет. Рисовать их руками нельзя:
 * тогда они разойдутся, и в разных местах будет разный знак.
 *
 * Рисует браузером, а не сторонней библиотекой: браузер у нас уже есть
 * (проверки интерфейса), а ещё одна зависимость ради четырёх картинок
 * в год — это деталь, которая ничего не добавляет.
 */
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const SVG = "frontend/public/favicon.svg";
const OUT = "frontend/public";

/** Что кому нужно: вкладка, закладка, плитка телефона. */
const SIZES = [
  { name: "favicon-32.png", px: 32 },
  { name: "favicon-180.png", px: 180 },
];

const svg = await readFile(SVG, "utf8");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { name, px } of SIZES) {
  // ⚠️ ФОН ПРОЗРАЧНЫЙ, А ЗНАК — ТЁМНЫЙ, И ЦВЕТ БЕРЁТСЯ ИЗ САМОГО SVG.
  // Растр не умеет меняться с темой браузера, как умеет SVG; выбираем
  // светлую, потому что панель вкладок светлая у большинства. У тех,
  // у кого тёмная, сработает SVG — он стоит первым в списке.
  //
  // Именно ПРИТВОРЯЕМСЯ светлой темой, а не вписываем цвет числом:
  // число здесь было бы вторым источником правды и разошлось бы
  // со знаком при первой же смене палитры.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<body style="margin:0"><div style="width:${px}px;height:${px}px">${svg}</div></body>`,
  );
  await page.screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  console.log(`${name} — ${px}×${px}`);
}

await browser.close();
