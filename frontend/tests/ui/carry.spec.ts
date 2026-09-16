import { expect, test } from "@playwright/test";
import { bubble, createChannel, openChannel, register, say } from "./fixtures.js";

/**
 * П-6 плана task-085: реплика приезжает самим событием, и вкладка за ней
 * никуда не идёт.
 *
 * ⚠️ ЭТО ПРОВЕРКА ЭКОНОМИИ, А НЕ КАРТИНКИ — как и сосед в `address.spec.ts`.
 * Что реплика появляется, проверено и там; здесь проверяется, что она
 * появляется БЕЗ второго обращения к серверу. Глазами эта разница не видна
 * совсем, а стоит она четырёх пятых цены события при тысячах вкладок.
 *
 * Считаем запросы, а не время: время на стенде дрожит, число — нет.
 */
test("реплика в открытом чате приезжает событием, без запроса ленты", async ({ page }) => {
  await register(page);
  await createChannel(page, "Смета");
  await openChannel(page, "Смета");
  await say(page, "первая");
  await expect(bubble(page, "первая")).toBeVisible();

  // Считать начинаем ПОСЛЕ того, как вкладка устоялась: её собственная
  // загрузка честно ходит в догон, и это не то, что мы проверяем.
  const caughtUp: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/sync")) caughtUp.push(request.url());
  });

  const other = await page.context().newPage();
  await other.goto("/");
  await openChannel(other, "Смета");
  await say(other, "вторая из другой вкладки");

  // Положительный признак вместо паузы: реплика на экране — значит событие
  // доехало И обработано. Если бы клиент шёл за ней в догон, запрос успел бы
  // случиться до этого мига.
  await expect(bubble(page, "вторая из другой вкладки")).toBeVisible();

  expect(caughtUp, "за репликой, приехавшей в событии, ходить незачем").toHaveLength(0);

  await other.close();
});
