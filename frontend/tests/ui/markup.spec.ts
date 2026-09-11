import { expect, test } from "@playwright/test";
import { bubble, createChannel, field, menu, register, say, typeInto } from "./fixtures.js";

/**
 * РАЗМЕТКА ВПЕРЕМЕШКУ И ПЛАШКА О КОПИРОВАНИИ (task-021, Р-028).
 *
 * ⚠️ ЭТИ СЦЕНАРИИ ЗАКРЫВАЮТ ТО, ЧТО БЫСТРЫЕ ПРОВЕРКИ ЗАКРЫТЬ НЕ МОГУТ.
 * Круг «строка → дерево → строка» доказывает согласие разбора со сборкой,
 * но не отвечает на вопрос человека: «я нажал два раза — я это вижу?»
 * Между ними лежит целый слой — выделение, сочетания клавиш, показ.
 * Владелец жаловался именно на него.
 *
 * ⚠️ СМОТРИМ НА ВИДИМОЕ, А НЕ НА КЛАССЫ (Р-022 §3). Жирный — это `strong`,
 * курсив — `em`, моноширинный — `code`: роли, а не оформление. Оформление
 * сменится завтра, роль — нет.
 */

/** Выделить всё в поле и наложить вид сочетанием клавиш. */
async function applyFormat(
  page: import("@playwright/test").Page,
  ...shortcuts: string[]
): Promise<void> {
  await field(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  for (const shortcut of shortcuts) await page.keyboard.press(shortcut);
}

test("два вида на одном слове показываются оба, и ни одной звёздочки", async ({ page }) => {
  await register(page);
  await createChannel(page, "Разметка");

  await field(page).click();
  await field(page).pressSequentially("вперемешку");

  // ⚠️ ДВА СОЧЕТАНИЯ ПОДРЯД, БЕЗ ПОВТОРНОГО ВЫДЕЛЕНИЯ. Ровно это и не
  // работало: пометка схлопывала выделение, и второй вид ложиться было
  // некуда. Повтори здесь выделение между нажатиями — и сценарий
  // перестанет стеречь то, ради чего написан.
  await applyFormat(page, "ControlOrMeta+b", "ControlOrMeta+i");

  await expect(page.getByLabel("Отправить", { exact: true })).toBeEnabled();
  await field(page).press("Enter");

  const message = bubble(page, "вперемешку");
  await expect(message.locator("strong em")).toHaveText("вперемешку");
  // Звёздочки в ленте — тот самый видимый признак поломки.
  await expect(message).not.toContainText("*");
});

/**
 * Как ВЫГЛЯДИТ слово в поле ввода.
 *
 * ⚠️ ЧЕРЕЗ ВЫЧИСЛЕННЫЙ ВИД, А НЕ ЧЕРЕЗ КЛАССЫ. Правило Р-022 §3 запрещает
 * локаторы по классам, и правильно: класс — это разметка. Но здесь нужно
 * увидеть ровно то, что видит человек, — насколько жирно и каким шрифтом.
 * Толщина и гарнитура классами не являются: это итог, а не способ его
 * добиться, и смена оформления их не сдвинет.
 */
async function styleInField(page: import("@playwright/test").Page, word: string) {
  return field(page).evaluate((node, needle) => {
    const all = [...node.querySelectorAll("*")].filter((one) => one.textContent === needle);
    const deepest = all.at(-1) ?? node;
    const style = getComputedStyle(deepest);
    return { weight: Number(style.fontWeight), font: style.fontFamily.toLowerCase() };
  }, word);
}

test("моноширинный снимает жирный прямо в поле", async ({ page }) => {
  await register(page);
  await createChannel(page, "Разметка");

  await field(page).click();
  await field(page).pressSequentially("двойка");
  await applyFormat(page, "ControlOrMeta+b");
  await applyFormat(page, "ControlOrMeta+Shift+m");

  /**
   * ⚠️ СМОТРИМ В ПОЛЕ, А НЕ ТОЛЬКО В ЛЕНТУ, И ЭТО ИСПРАВЛЕНИЕ САМОГО
   * СЦЕНАРИЯ. Сперва он проверял одну ленту — и обратная проверка его
   * не свалила: снял запрет из поля, а сценарий всё равно зелёный.
   * Причина в том, что схлопывание есть ВТОРЫМ рубежом при сборке строки,
   * и лента выглядела правильно в обоих случаях. Проверялся исход, а не
   * обещание Р-028: жирный снимается НА ГЛАЗАХ, в поле.
   */
  const style = await styleInField(page, "двойка");
  expect(style.weight).toBeLessThan(600);
  expect(style.font).toContain("mono");

  await expect(page.getByLabel("Отправить", { exact: true })).toBeEnabled();
  await field(page).press("Enter");

  const message = bubble(page, "двойка");
  await expect(message.locator("code")).toHaveText("двойка");
  // Жирного не осталось — совмещения нет по Р-028.
  await expect(message.locator("strong")).toHaveCount(0);
  await expect(message).not.toContainText("`");
});

test("скопировал текст реплики — увидел плашку, и она ушла сама", async ({ page, context }) => {
  // Буфер обмена в браузере закрыт без разрешения, а плашка обязана
  // сказать правду об исходе — значит разрешение нужно выдать.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await register(page);
  await createChannel(page, "Копирование");
  await say(page, "строка для буфера");

  await menu(page, "строка для буфера", "Копировать текст");

  const toast = page.getByText("Текст скопирован в буфер обмена.");
  await expect(toast).toBeVisible();
  // Живёт 1500 и гаснет ещё 1000 — к четырём секундам её быть не должно.
  await expect(toast).toBeHidden({ timeout: 4000 });
});

test("нажатие на моноширинный кусок копирует его — как в Телеграме", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await register(page);
  await createChannel(page, "Моноширинный");
  // ⚠️ НЕ ЧЕРЕЗ `say`: тот ищет пузырь по НАБРАННОЙ строке, а в ленте
  // кавычек уже нет — они стали моноширинным. Ищем по обычному слову.
  await typeInto(page, "команда `make check` работает", "Отправить");
  await expect(bubble(page, "работает").getByLabel("доставлено")).toBeVisible();

  /**
   * ⚠️ ЖМЁМ ПО САМОМУ КУСКУ, А НЕ ПО РЕПЛИКЕ. У них это
   * `MonospaceClickHandler`: нажатие на моноширинный кладёт его в буфер
   * и показывает плашку. Владелец поймал, что у нас так не было: «нажимая
   * на моноширинный, как в тг, я не могу его скопировать».
   */
  await bubble(page, "работает").getByText("make check", { exact: true }).click();

  await expect(page.getByText("Текст скопирован в буфер обмена.")).toBeVisible();

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe("make check");
});
