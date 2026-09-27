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
 * ⚠️ СМОТРИМ ВСЁ ОКНО ЗАПАЗДЫВАНИЯ, А НЕ ОДИН КАДР. Черта живёт секунды,
 * до следующей отметки: разовая проверка «черты нет» прошла бы и на
 * сломанном коде, если бы попала после отметки.
 */

/** Черта на экране — по её надписи, как её видит человек. */
const LINE_TEXT = "Непрочитанные сообщения";

test("отправил в новый чат — черты «Непрочитанные» нет ни на миг", async ({ page }) => {
  await register(page, "Пишущий себе");
  await createChannel(page, "Свои реплики");
  const room = new URL(page.url()).pathname.split("/").pop() ?? "";

  // Отметки, на которые сервер уже ответил: номер из запроса.
  const confirmed: number[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.url().endsWith(`/${room}/read`)) {
      confirmed.push(Number((request.postDataJSON() as { seq: number }).seq));
    }
  });

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

  // Окно запаздывания кончается ответом на отметку, догнавшую последнюю
  // реплику: дальше черте рисоваться не из чего. Это признак вместо сна.
  const answer = await page.request.get(`/v1/conversations/${room}/messages`);
  expect(answer.status(), "лента чата не прочиталась").toBe(200);
  const { items } = (await answer.json()) as { items: { seq: number }[] };
  const last = items.at(-1)?.seq ?? Number.POSITIVE_INFINITY;
  await expect
    .poll(() => Math.max(0, ...confirmed), {
      timeout: 10_000,
      message: "отметка не догнала свою последнюю реплику",
    })
    .toBeGreaterThanOrEqual(last);

  const seen = await page.evaluate(
    () => (window as unknown as { unreadLineSeen: boolean }).unreadLineSeen,
  );
  expect(seen, "черта над своими репликами").toBe(false);
  await expect(page.getByText(LINE_TEXT)).toHaveCount(0);
});
