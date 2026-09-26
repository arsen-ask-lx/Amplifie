import { expect, test } from "@playwright/test";
import { createChannel, menu, register, say } from "./fixtures.js";

/**
 * ОТКАЗ В ЗАКРЕПЕ ВИДЕН ЧЕЛОВЕКУ (Р-045).
 *
 * Сервер не принимает сто первое закрепление и слишком частые закрепы —
 * это доказывает приёмочный `backend/tests/pins.e2e.test.ts`. Здесь другой
 * вопрос: увидит ли человек, ПОЧЕМУ не закрепилось. До Р-045 отказ закрепа
 * молча терялся (\`void chat.pin(...)\`), и «ничего не произошло» было всем,
 * что человек узнавал.
 *
 * ⚠️ ОТВЕТ СЕРВЕРА ПОДМЕНЁН, И ЭТО СОЗНАТЕЛЬНО. Настоящая сотня закрепов
 * требует пяти человек и минуты порога — это цена приёмочного, а не вида.
 */
for (const [status, error, words] of [
  [409, "pin_limit", "уже 100 закреплённых"],
  [429, "rate_limited", "Слишком часто"],
] as const) {
  test(`закреп отклонён (${status}) — человек видит причину`, async ({ page }) => {
    await register(page, "Закрепляющий");
    await createChannel(page, "Смета");
    await say(page, "важное");
    await page.route("**/v1/messages/*/pin", (route) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error }) }),
    );
    await menu(page, "важное", "Закрепить");
    await expect(page.getByText(words)).toBeVisible();
    await expect(page.getByTitle("Перейти к закреплённому")).toHaveCount(0);
  });
}
