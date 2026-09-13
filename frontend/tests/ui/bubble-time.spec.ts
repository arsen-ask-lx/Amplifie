import { expect, test } from "@playwright/test";
import { bubble, createChannel, fontsReady, register, say } from "./fixtures.js";

/**
 * Время в углу реплики не налезает на её текст — иначе последнее слово
 * не прочесть.
 *
 * Проверяется только это. Сколько воздуха между словом и временем и насколько
 * время свисает за поле — решение дизайна (правила tdesktop, `Corner.tsx`),
 * и числа здесь ломали бы тест при каждой правке вида (AGENTS.md#тесты).
 *
 * Конец текста меряется диапазоном, а не рамкой узла: в строчном узле рядом
 * с текстом лежит невидимая распорка под время, и рамка узла её включила бы.
 */
const gapBeforeTime = (text: string): number => {
  const article = document.querySelector("article");
  const time = article?.querySelector("time");
  const corner = time?.parentElement;
  const bubbleBox = corner?.offsetParent;
  if (!corner || !(bubbleBox instanceof HTMLElement)) throw new Error("угол не привязан к пузырю");

  const walker = document.createTreeWalker(bubbleBox, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue?.includes(text)) textNode = node;
  }
  if (!textNode) throw new Error("текст реплики не найден");

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const lastLine = Array.from(range.getClientRects()).at(-1);
  if (!lastLine) throw new Error("у текста нет строк");

  return corner.getBoundingClientRect().left - lastLine.right;
};

test("время в углу реплики не налезает на последнее слово", async ({ page }) => {
  await register(page);
  await createChannel(page, "Часы");

  // Короткая реплика: время стоит на одной строке с текстом — худший случай.
  const text = "Привет";
  await say(page, text);
  await expect(bubble(page, text).locator("time")).toBeVisible();
  // После загрузки нашего шрифта: у запасного другая ширина знака.
  await fontsReady(page);

  expect(await page.evaluate(gapBeforeTime, text)).toBeGreaterThan(0);
});

