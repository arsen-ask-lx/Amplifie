import { expect, test } from "@playwright/test";
import { register } from "./fixtures.js";

test("настройки открываются по адресу, показывают профиль и возвращают в приложение", async ({
  page,
}) => {
  const person = await register(page, "Настроечник");

  await page.goto("/settings/profile");

  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByText(person.name, { exact: true })).toBeVisible();
  await expect(page.getByText(person.email, { exact: true })).toBeVisible();
  await expect(page.getByText(`Пространство ${person.name}`, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Вернуться в приложение" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
});

test("внешний вид меняет масштаб и хранит выбор после перезагрузки", async ({ page }) => {
  await register(page, "Зрение");

  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "125%" }).click();

  await expect(page.getByRole("heading", { name: "Внешний вид" })).toBeVisible();
  await expect(page.getByText("Размер текста", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Внешний вид" })).toHaveCSS("font-size", "25px");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Внешний вид" })).toHaveCSS("font-size", "25px");
});

test("тема выбирается из понятных образцов и сохраняется", async ({ page }) => {
  await register(page, "Читатель");

  await page.goto("/settings/appearance");

  const themes = page.getByRole("button", { name: /Светлая|Бумага|Сепия|Сумерки|Ночь/ });
  await expect(themes).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Бумага" })).toHaveAttribute(
    "aria-description",
    "Мягкий кремовый фон для долгой работы днём",
  );

  await page.getByRole("button", { name: "Бумага" }).click();
  await expect(page.getByRole("button", { name: "Бумага" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "бумага");

  await page.reload();
  await expect(page.getByRole("button", { name: "Бумага" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("системная тема не предлагается в подробном выборе", async ({ page }) => {
  await register(page, "Явный выбор");
  await page.goto("/settings/appearance");

  await expect(page.getByRole("button", { name: "Как в системе" })).toHaveCount(0);
});

test("светлая тема и монохром различаются не только названием", async ({ page }) => {
  await register(page, "Без дублей");
  await page.goto("/settings/appearance");

  const background = async (label: string) =>
    page
      .getByRole("button", { name: label, exact: true })
      .locator("[data-theme]")
      .evaluate((element) => getComputedStyle(element).backgroundColor);

  await expect.poll(() => background("Светлая")).not.toBe(await background("Монохром"));
});

test("редкие палитры скрыты под «Ещё темы», а алая и малина не предлагаются", async ({ page }) => {
  await register(page, "Коллекционер");

  await page.goto("/settings/appearance");

  await expect(page.getByRole("button", { name: "Ещё темы" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Оксокарбон" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Алая" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Малина" })).toHaveCount(0);

  await page.getByRole("button", { name: "Ещё темы" }).click();
  await page.getByRole("button", { name: "Оксокарбон" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "оксокарбон");

  await page.reload();
  await expect(page.getByRole("button", { name: "Оксокарбон" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("меню профиля ведёт к реальным действиям, а не к вложенным настройкам", async ({ page }) => {
  await register(page, "Меню");

  await page.getByLabel("Профиль и настройки").click();

  await expect(page.getByRole("menuitem", { name: "Профиль" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Пригласить в пространство" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Настройки" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Оформление" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Размер текста" })).toHaveCount(0);
});
