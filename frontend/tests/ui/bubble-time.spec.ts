import { expect, test } from "@playwright/test";
import { bubble, createChannel, fontsReady, register, say } from "./fixtures.js";

/**
 * Время в углу реплики стоит там же, где у Телеграма.
 *
 * ⚠️ ЧИСЛА НЕ ПРИДУМАНЫ, А ВЗЯТЫ ИЗ ИСХОДНИКОВ tdesktop. Владелец сказал
 * «время слишком близко к сообщению», и на глаз это не чинится: подвинешь
 * на два пикселя — станет «вроде лучше», а через неделю снова не то.
 * У Телеграма это три числа в `ui/chat/chat.style`:
 *
 *   msgPadding: margins(11px, 8px, 11px, 8px)  — поля текста в пузыре
 *   msgDateDelta: point(2px, 5px)              — насколько время ВЫХОДИТ за них
 *   msgDateSpace: 12px                         — воздух перед временем
 *
 * и два правила поверх них (`history_view_message.cpp`,
 * `history_view_element.cpp`):
 *
 *   infoRight  = правый край − (msgPadding.right − msgDateDelta.x)
 *   infoBottom = нижний край − (msgPadding.bottom − msgDateDelta.y)
 *   skipBlockWidth = msgDateSpace + ширина времени − msgDateDelta.x
 *
 * То есть время НЕ выровнено по тексту: оно свисает за его поле вправо
 * и вниз, а место под него отводится с запасом в десять точек. Отсюда
 * и ощущение воздуха, которого у нас не было.
 *
 * Наши поля пузыря — 12 px, поэтому те же правила дают: 10 px от правого
 * края, 3 px от нижнего, не меньше 10 px воздуха между словами и временем.
 */

/**
 * `msgDateDelta` Телеграма: на столько время свисает за поле текста.
 *
 * ⚠️ СЧИТАЕТСЯ ОТ ПОЛЯ ТЕКСТА, А НЕ ОТ КРАЯ ПУЗЫРЯ. У Телеграма пузырь
 * без рамки, у нас рамка в точку — меряя от внешнего края, мы сравнивали
 * бы разные вещи и подгоняли число под рамку. Поле и рамку берём
 * у самого пузыря, а не повторяем числами здесь: повтор разъедется
 * с `Bubble.tsx` в первый же раз, когда поля тронут.
 */
const OVERHANG_RIGHT = 2;
const OVERHANG_BOTTOM = 5;

/** `msgDateSpace − msgDateDelta.x`: воздух между последним словом и временем. */
const GAP = 10;

interface Measure {
  /** Просвет между концом текста и началом времени. */
  gap: number;
  /** Насколько время свисает за правое поле текста. */
  overhangRight: number;
  /** Насколько время свисает за нижнее поле текста. */
  overhangBottom: number;
}

/**
 * ⚠️ КОНЕЦ ТЕКСТА МЕРЯЕТСЯ ДИАПАЗОНОМ, А НЕ РАМКОЙ УЗЛА. Текст лежит
 * в строчном узле вместе с распоркой под время: рамка узла включила бы
 * распорку, и просвет вышел бы нулевым при любом коде — тест был бы
 * зелёным всегда.
 */
const measure = (text: string): Measure => {
  const article = document.querySelector("article");
  if (!article) throw new Error("реплики нет на странице");

  const time = article.querySelector("time");
  if (!time) throw new Error("времени нет в реплике");

  const corner = time.parentElement;
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
  const lastRect = Array.from(range.getClientRects()).at(-1);
  if (!lastRect) throw new Error("у текста нет строк");

  const cornerRect = corner.getBoundingClientRect();
  const bubbleRect = bubbleBox.getBoundingClientRect();
  const style = getComputedStyle(bubbleBox);
  const px = (prop: string) => Number.parseFloat(style.getPropertyValue(prop)) || 0;

  // Правый и нижний края ПОЛЯ ТЕКСТА — то, за что время и свисает.
  const paddingRight = bubbleRect.right - px("border-right-width") - px("padding-right");
  const paddingBottom = bubbleRect.bottom - px("border-bottom-width") - px("padding-bottom");

  return {
    gap: Math.round(cornerRect.left - lastRect.right),
    overhangRight: Math.round(cornerRect.right - paddingRight),
    overhangBottom: Math.round(cornerRect.bottom - paddingBottom),
  };
};

test("время в углу реплики стоит по правилам Телеграма", async ({ page }) => {
  await register(page);
  await createChannel(page, "Часы");

  // Короткая реплика: время обязано уместиться на одной строке с текстом —
  // именно этот случай владелец и видел тесным.
  const text = "Привет";
  await say(page, text);
  await expect(bubble(page, text).locator("time")).toBeVisible();
  // Меряем ПОСЛЕ того, как доехал наш шрифт: у системного запасного
  // другая ширина знака, и просвет вышел бы другим.
  await fontsReady(page);

  const measured = await page.evaluate(measure, text);

  expect(measured.gap).toBeGreaterThanOrEqual(GAP);
  expect(measured.overhangRight).toBe(OVERHANG_RIGHT);
  expect(measured.overhangBottom).toBe(OVERHANG_BOTTOM);
});
