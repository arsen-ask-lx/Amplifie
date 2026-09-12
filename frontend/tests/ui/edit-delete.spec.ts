import { expect, test } from "@playwright/test";
import { bubble, createChannel, field, menu, register, say } from "./fixtures.js";

/**
 * Изменить и удалить — как в Телеграме (task-061).
 *
 * В-5: удаление спрашивает, «Отмена» оставляет реплику на месте.
 * В-6: `↑` в пустом поле открывает правку последней своей реплики.
 *
 * Перед запуском: make up
 */

test("удаление спрашивает, а «Отмена» оставляет реплику", async ({ page }) => {
  await register(page);
  await createChannel(page, "Чистовик");
  await say(page, "лишняя реплика");

  await menu(page, "лишняя реплика", "Удалить");
  const ask = page.getByRole("dialog", { name: "Удалить сообщение?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Отмена" }).click();
  await expect(bubble(page, "лишняя реплика")).toBeVisible();

  await menu(page, "лишняя реплика", "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(bubble(page, "лишняя реплика")).toHaveCount(0);
});

test("стрелка вверх в пустом поле открывает правку последней своей", async ({ page }) => {
  await register(page);
  await createChannel(page, "Опечатки");
  await say(page, "первая");
  await say(page, "вторая с опечаткой");

  await field(page).click();
  await page.keyboard.press("ArrowUp");

  await expect(page.getByRole("button", { name: "Сохранить" })).toBeVisible();
  await expect(field(page)).toHaveText("вторая с опечаткой");
});
