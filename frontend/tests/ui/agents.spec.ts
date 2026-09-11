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
