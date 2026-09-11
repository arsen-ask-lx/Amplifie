import { expect, test } from "@playwright/test";
import { register } from "./fixtures.js";

test("размер текста в профиле увеличивает навигацию и переживает перезагрузку", async ({
  page,
}) => {
  await register(page, "Хозяин");

  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "125%" }).click();

  await expect(page.getByRole("heading", { name: "Внешний вид" })).toHaveCSS("font-size", "25px");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Внешний вид" })).toHaveCSS("font-size", "25px");
});
