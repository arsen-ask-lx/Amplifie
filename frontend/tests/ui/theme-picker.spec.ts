import { expect, test } from "@playwright/test";
import { register } from "./fixtures.js";

test("палитра в шапке меняет тему несколько раз и закрывается только снаружи", async ({ page }) => {
  await register(page, "Подбирающий тему");

  await expect(page.getByLabel("Выбрать тему")).toBeVisible();
  await page.getByLabel("Выбрать тему").click();

  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Как в системе" })).toHaveCount(0);
  await expect(page.getByText("Светлые", { exact: true })).toBeVisible();
  await expect(page.getByText("Тёмные", { exact: true })).toBeVisible();

  await page.getByRole("menuitem", { name: "Бумага" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "бумага");
  await expect(page.getByRole("menu")).toBeVisible();

  await page.getByRole("menuitem", { name: "Ночь" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ночь");
  await expect(page.getByRole("menu")).toBeVisible();

  await page.getByRole("heading", { name: "Общий" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ночь");
});
