import { expect, test } from "@playwright/test";
import { bubble, createChannel, field, register } from "./fixtures.js";

/**
 * Вставил текст и сразу нажал ввод — реплика уходит (Д-21).
 *
 * ⚠️ ГОНКА ВОСПРОИЗВОДИТСЯ НАРОЧНО, А НЕ КАК ПОВЕЗЁТ. Содержимое поля
 * живёт в двух местах: в самом редакторе и в копии у полосы ввода.
 * Копия обновляется слушателем, который редактор зовёт СЛЕДУЮЩИМ тактом,
 * а отправка читала копию. Кто вставлял текст и мгновенно бил по вводу —
 * не отправлял ничего: измерено 8 потерь из 12 живой вставкой.
 *
 * Живой вставкой такое мигает: между вставкой и вводом у Playwright два
 * разных вызова, и слушатель иногда успевает. Поэтому вставка и ввод
 * делаются ОДНИМ тактом страницы — тогда копия заведомо не догнала,
 * и сценарий либо краснеет всегда, либо зеленеет всегда.
 *
 * ⚠️ МИМО `typeInto` ИЗ ПОМОЩНИКОВ, И ЭТО СУТЬ. Тот ждёт, пока оживёт
 * кнопка отправки, — то есть ждёт ровно ту копию, и обходит беду стороной.
 * Здесь проверяется путь, которым ходит человек: ввод с клавиатуры.
 */

const TEXT = "вставил и сразу ввод";

test("вставка и мгновенный ввод одним тактом — реплика уходит", async ({ page }) => {
  await register(page, "Вставляющий");
  await createChannel(page, "Вставка");
  await field(page).click();

  // Один такт страницы: вставка, а следом нажатие. Слушатель редактора
  // между ними не вклинится — он зовётся микрозадачей после сверки.
  const dispatched = await page.evaluate((text) => {
    const editable = document.querySelector<HTMLElement>('[aria-label="Текст сообщения"]');
    if (!editable) return "поля нет";

    const carrier = new DataTransfer();
    carrier.setData("text/plain", text);
    const pasted = editable.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: carrier }),
    );

    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    // `false` от `dispatchEvent` значит, что вставку перехватил редактор,
    // — иначе она ушла бы в браузерную обработку и текста в поле бы не было.
    return pasted ? "вставку никто не перехватил" : "готово";
  }, TEXT);

  expect(dispatched, "вставка не дошла до редактора").toBe("готово");

  await expect(bubble(page, TEXT).getByLabel("доставлено")).toBeVisible();
  await expect(field(page), "поле осталось заполненным").toHaveText("");
});
