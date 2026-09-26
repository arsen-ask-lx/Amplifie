import { bubble, bubbles, createChannel, openChannel, register, rowMenu, say } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * П-5: переключение каналов не смешивает ленты.
 *
 * ⚠️ ПОЧЕМУ ИМЕННО ЭТО. Слияние догона с лентой переписывалось трижды,
 * и каждый раз чужие реплики просачивались по-новому: клиент держит
 * сообщения ВСЕХ разговоров в одном месте и отбирает нужные при показе
 * (Д-11). Один неверный отбор — и человек читает в «Смете» переписку
 * из «Найма». Проверка чистой функции слияния при этом зелёная: она
 * не знает, какой разговор открыт.
 */

test("реплики чужого канала не просвечивают при переключении", async ({ page }) => {
  await register(page);

  await createChannel(page, "Смета");
  await say(page, "смета готова к пятнице");

  await createChannel(page, "Наём");
  await say(page, "собеседование во вторник");

  // Во втором канале — только его собственная реплика. Именно здесь
  // просачивалось: догон приносил чужие, и они ложились в ленту.
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubble(page, "собеседование во вторник")).toBeVisible();
  await expect(bubble(page, "смета готова к пятнице")).toHaveCount(0);

  // И обратно: возврат в первый канал не тащит за собой второй.
  await openChannel(page, "Смета");
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubble(page, "смета готова к пятнице")).toBeVisible();
  await expect(bubble(page, "собеседование во вторник")).toHaveCount(0);
});

test("удалённый канал уходит из панели вместе со своей перепиской", async ({ page }) => {
  await register(page);
  await createChannel(page, "Черновик");
  await say(page, "это временный канал");

  await rowMenu(page, "Черновик");
  await page.getByRole("menuitem", { name: "Удалить чат" }).click();
  // Спрашиваем перед необратимым — и подтверждение обязано быть отдельным
  // шагом, а не тем же нажатием.
  await page.getByRole("button", { name: "Удалить", exact: true }).click();

  await expect(page.getByRole("button", { name: "Черновик", exact: true })).toHaveCount(0);
  await expect(bubble(page, "это временный канал")).toHaveCount(0);
});

/**
 * Адрес чата легко пережить: базу стёрли, чат удалили, вошли другим
 * человеком. Тогда сервер отвечает «нет такого», и экран обязан показать
 * живой чат, а не висеть с отказом (владелец ловил это не раз).
 */
test("адрес несуществующего чата открывает живой, а не отказ", async ({ page }) => {
  await register(page, "Потерянный");
  await createChannel(page, "Живой");

  await page.goto("/c/01a09049-0000-7000-8000-000000000000");

  await expect(page.getByText("Не удалось загрузить сообщения")).toHaveCount(0);
  await expect
    .poll(async () => new URL(page.url()).pathname, { message: "остались на мёртвом адресе" })
    .not.toBe("/c/01a09049-0000-7000-8000-000000000000");
});
