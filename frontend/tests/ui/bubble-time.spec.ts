import { expect, test } from "@playwright/test";
import { bubble, createChannel, register, say } from "./fixtures.js";

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
const СВЕС_ВПРАВО = 2;
const СВЕС_ВНИЗ = 5;

/** `msgDateSpace − msgDateDelta.x`: воздух между последним словом и временем. */
const ВОЗДУХ = 10;

interface Мерка {
  /** Просвет между концом текста и началом времени. */
  воздух: number;
  /** Насколько время свисает за правое поле текста. */
  свесВправо: number;
  /** Насколько время свисает за нижнее поле текста. */
  свесВниз: number;
}

/**
 * ⚠️ КОНЕЦ ТЕКСТА МЕРЯЕТСЯ ДИАПАЗОНОМ, А НЕ РАМКОЙ УЗЛА. Текст лежит
 * в строчном узле вместе с распоркой под время: рамка узла включила бы
 * распорку, и просвет вышел бы нулевым при любом коде — тест был бы
 * зелёным всегда.
 */
const МЕРИТЬ = (текст: string): Мерка => {
  const реплика = document.querySelector("article");
  if (!реплика) throw new Error("реплики нет на странице");

  const время = реплика.querySelector("time");
  if (!время) throw new Error("времени нет в реплике");

  const угол = время.parentElement;
  const пузырь = угол?.offsetParent;
  if (!угол || !(пузырь instanceof HTMLElement)) throw new Error("угол не привязан к пузырю");

  const обход = document.createTreeWalker(пузырь, NodeFilter.SHOW_TEXT);
  let слова: Text | null = null;
  while (обход.nextNode()) {
    const узел = обход.currentNode as Text;
    if (узел.nodeValue?.includes(текст)) слова = узел;
  }
  if (!слова) throw new Error("текст реплики не найден");

  const диапазон = document.createRange();
  диапазон.selectNodeContents(слова);
  const последняя = Array.from(диапазон.getClientRects()).at(-1);
  if (!последняя) throw new Error("у текста нет строк");

  const у = угол.getBoundingClientRect();
  const п = пузырь.getBoundingClientRect();
  const вид = getComputedStyle(пузырь);
  const число = (имя: string) => Number.parseFloat(вид.getPropertyValue(имя)) || 0;

  // Правый и нижний края ПОЛЯ ТЕКСТА — то, за что время и свисает.
  const полеСправа = п.right - число("border-right-width") - число("padding-right");
  const полеСнизу = п.bottom - число("border-bottom-width") - число("padding-bottom");

  return {
    воздух: Math.round(у.left - последняя.right),
    свесВправо: Math.round(у.right - полеСправа),
    свесВниз: Math.round(у.bottom - полеСнизу),
  };
};

test("время в углу реплики стоит по правилам Телеграма", async ({ page }) => {
  await register(page);
  await createChannel(page, "Часы");

  // Короткая реплика: время обязано уместиться на одной строке с текстом —
  // именно этот случай владелец и видел тесным.
  const текст = "Привет";
  await say(page, текст);
  await expect(bubble(page, текст).locator("time")).toBeVisible();

  const мерка = await page.evaluate(МЕРИТЬ, текст);

  expect(мерка.воздух).toBeGreaterThanOrEqual(ВОЗДУХ);
  expect(мерка.свесВправо).toBe(СВЕС_ВПРАВО);
  expect(мерка.свесВниз).toBe(СВЕС_ВНИЗ);
});
