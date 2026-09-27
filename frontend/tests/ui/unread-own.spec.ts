import { createChannel, register, say } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * ЧЕРТА «НЕПРОЧИТАННЫЕ» НЕ ВСТАЁТ НАД СВОИМИ РЕПЛИКАМИ (Д-58).
 *
 * Отметка прочтения уходит на сервер окном, раз в три секунды, и сразу
 * после отправки она отстаёт от номера своей реплики. Черта рисовалась
 * по этой отметке — и человек видел «у вас непрочитанное» над тем, что
 * сам только что написал. Счётчик панели так не врёт: свои реплики он
 * не считает. Черта обязана следовать тому же правилу.
 *
 * ⚠️ СМОТРИМ С ДО ОТПРАВКИ И ДО КОНЦА, А НЕ ОДИН КАДР. Черта встаёт перед
 * первой чужой репликой за границей, а граница замирает при открытии чата:
 * сломанный фильтр своих нарисовал бы черту с первой же доставкой. Ждать
 * после доставки нечего — и отметку на свою последнюю ждать нельзя: её
 * вкладка не шлёт вовсе (Д-88; так этот тест покраснел в CI 27.09).
 */

/** Черта на экране — по её надписи, как её видит человек. */
const LINE_TEXT = "Непрочитанные сообщения";

test("отправил в новый чат — черты «Непрочитанные» нет ни на миг", async ({ page }) => {
  await register(page, "Пишущий себе");
  await createChannel(page, "Свои реплики");

  /**
   * ⚠️ НАБЛЮДАТЕЛЬ ВМЕСТО ОПРОСА РАЗ В 100 МС. Он видит каждое изменение
   * страницы, а не пятнадцать кадров из полутора секунд, и ставится ДО
   * отправки: черта, мелькнувшая между кадрами, тоже поломка.
   */
  await page.evaluate((text) => {
    const box = window as unknown as { unreadLineSeen: boolean };
    box.unreadLineSeen = false;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll("p")) {
        if (node.textContent?.includes(text)) box.unreadLineSeen = true;
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, LINE_TEXT);

  await say(page, "первая своя");
  await say(page, "вторая своя");

  // `say` дождался доставки обеих: они записаны сервером и нарисованы.
  const seen = await page.evaluate(
    () => (window as unknown as { unreadLineSeen: boolean }).unreadLineSeen,
  );
  expect(seen, "черта над своими репликами").toBe(false);
  await expect(page.getByText(LINE_TEXT)).toHaveCount(0);
});
