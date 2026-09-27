import { register } from "./fixtures.js";
import { expect, test } from "./guard.js";

test("размер текста 125% делает текст крупнее и переживает перезагрузку", async ({ page }) => {
  await register(page, "Хозяин");

  await page.goto("/settings/appearance");
  const heading = page.getByRole("heading", { name: "Внешний вид" });
  await expect(page.getByText("Размер текста", { exact: true })).toBeVisible();
  const sizeOf = () =>
    heading.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));

  // Проверяется суть выбора — текст стал крупнее и таким остался, —
  // а не число из дизайна: базовый размер вправе меняться.
  const before = await sizeOf();
  await page.getByRole("button", { name: "125%" }).click();
  await expect.poll(sizeOf).toBeGreaterThan(before);
  const chosen = await sizeOf();

  await page.reload();
  await expect.poll(sizeOf).toBe(chosen);
});
