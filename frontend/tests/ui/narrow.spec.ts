import { createChannel, register } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * УЗКИЙ ЭКРАН (Д-28). На 390 px панель чатов забирала 256 px, и переписке
 * оставалось 124 — половина экрана под список. Теперь панель выезжает
 * поверх, как в Telegram на телефоне: переписка — во всю ширину.
 */

const main = (page: Page) => page.locator("main");
const rail = (page: Page) => page.locator("aside");

async function noSideScroll(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll, "страница прокручивается вбок").toBeLessThanOrEqual(client);
}

test("на узком экране переписка во всю ширину, панель выезжает поверх и уезжает", async ({
  page,
}) => {
  await register(page, "С телефона");
  await createChannel(page, "Смета");
  // Вход и заводка чата идут через панель — поэтому сужаем уже после них.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();

  // На узком экране панель по умолчанию задвинута: человек пришёл читать.
  const toggle = page.getByRole("button", { name: /панель/u }).first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    (await main(page).boundingBox())?.width ?? 0,
    "переписке не хватает ширины",
  ).toBeGreaterThan(380);
  await noSideScroll(page);

  // Открыть с клавиатуры: панель поверх, переписка не сжимается.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail(page).getByRole("button", { name: /^Смета/u })).toBeVisible();
  expect(
    (await main(page).boundingBox())?.width ?? 0,
    "открытая панель сжала переписку",
  ).toBeGreaterThan(380);

  // Щелчок мимо панели её закрывает.
  await page.mouse.click(370, 400);
  await expect(page.getByRole("button", { name: /панель/u }).first()).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Выбор чата из панели тоже её закрывает.
  await page
    .getByRole("button", { name: /панель/u })
    .first()
    .click();
  await rail(page)
    .getByRole("button", { name: /^Смета/u })
    .click();
  await expect(page.getByRole("button", { name: /панель/u }).first()).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await noSideScroll(page);

  await page.goto("/settings/appearance");
  await noSideScroll(page);
});
