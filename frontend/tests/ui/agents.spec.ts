import { expect, test } from "@playwright/test";
import { register } from "./fixtures.js";

test("агенты оставляют две рабочие секции без вступительных пояснений", async ({ page }) => {
  await register(page, "Оператор");
  await page.goto("/settings/agents");

  await expect(page.getByRole("heading", { name: "Своя подписка" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ключ API" })).toBeVisible();
  await expect(page.getByText(/Нужен установленный клиент/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Подключить" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ключ", exact: true })).toBeVisible();
});

test("агенты живут в настройках, а старая ссылка ведёт туда же", async ({ page }) => {
  await register(page, "Оператор");

  await page.goto("/agents");
  await expect(page).toHaveURL(/\/settings\/agents$/);
  await expect(page.getByRole("link", { name: "Агенты" })).toBeVisible();

  await page.goto("/board");
  await expect(page.getByRole("link", { name: "Агенты" })).toHaveCount(0);
});

test("форма агентов стоит в общей центральной колонке настроек", async ({ page }) => {
  await register(page, "Широкая форма");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/settings/agents");

  const geometry = await page
    .getByRole("textbox", { name: "Ключ", exact: true })
    .evaluate((element) => {
      const field = element.getBoundingClientRect();
      const main = element.closest("main")?.getBoundingClientRect();
      if (!main) throw new Error("не найдена основная область настроек");
      return {
        width: Math.round(field.width),
        left: Math.round(field.left - main.left),
        right: Math.round(main.right - field.right),
      };
    });

  expect(geometry.width).toBeLessThanOrEqual(896);
  expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1);
});

test("поле API-ключа остаётся ровным при фокусе", async ({ page }) => {
  await register(page, "Оператор");
  await page.goto("/settings/agents");

  const key = page.getByRole("textbox", { name: "Ключ", exact: true });
  await expect(key).toHaveCSS("border-top-width", "0px");
  await expect(key).toHaveCSS("border-bottom-width", "1px");
  await key.focus();
  await expect(key).toHaveCSS("border-bottom-width", "1px");

  // Tailwind разворачивает `shadow-none` в несколько прозрачных теней,
  // поэтому строка свойства не равна literal `none`. Проверяем эффект,
  // а не внутреннее представление движка: непрозрачной тени нет.
  const hasVisibleShadow = await key.evaluate((element) => {
    const shadow = getComputedStyle(element).boxShadow;
    return Array.from(
      shadow.matchAll(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/gu),
      (match) => Number(match[1]) > 0,
    ).some(Boolean);
  });
  expect(hasVisibleShadow).toBe(false);
});
