import { expect, type Page, test } from "@playwright/test";
import { register, rowMenu } from "./fixtures.js";

/**
 * ОКНА С ЧИСТОГО ЛИСТА И ВИД ПРОЕКТА (task-103). Написан ДО правки и обязан
 * быть красным.
 *
 * Владелец 17.09: второй «+» открывал «Новый проект» с прежним названием,
 * значком и цветом — будто редактируешь созданный. Причина общая у всех
 * окон-форм: окно пряталось, а не снималось, и поля жили между открытиями.
 * Поэтому проверяется и «Новый чат» — у него та же болезнь после «Отмены».
 */

test.describe.configure({ timeout: 120_000 });

function projectDialog(page: Page) {
  return page.getByRole("dialog");
}

/** Кнопки цвета в окне: у каждой подпись, и нажатая отмечена `aria-pressed`. */
const COLORS = 16;

test("второе открытие «Нового проекта» — пустое окно, а не прежний проект", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Объект");
  await page.getByRole("button", { name: "Настроить вид" }).click();
  await page.getByRole("button", { name: "Портфель" }).click();
  await page.getByRole("button", { name: "Оранжевый" }).click();
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(projectDialog(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Новый проект" }).click();
  await expect(page.getByLabel("Название проекта"), "окно помнит прежнее название").toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Настроить вид" }),
    "настройка вида осталась раскрытой",
  ).toBeVisible();
  await page.getByRole("button", { name: "Настроить вид" }).click();
  await expect(projectDialog(page).locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Правка открывает СВОЙ проект, а следующий «+» — снова пустое окно.
  await rowMenu(page, "Объект");
  await page.getByRole("menuitem", { name: "Редактировать проект" }).click();
  await expect(page.getByLabel("Название проекта")).toHaveValue("Объект");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Новый проект" }).click();
  await expect(
    page.getByLabel("Название проекта"),
    "после правки окно заводки не пустое",
  ).toHaveValue("");
});

test("«Новый чат» после «Отмены» не помнит набранное", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await page.getByLabel("Название нового чата").fill("Недописанный");
  await page.getByRole("button", { name: "Отмена" }).click();

  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.getByLabel("Название нового чата")).toHaveValue("");
});

test("у проекта 16 цветов, и новый цвет доезжает до сервера", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Бирюзовый объект");
  await page.getByRole("button", { name: "Настроить вид" }).click();
  // Цвета — своей подписанной группой: рядом девяносто кнопок-значков.
  const colors = projectDialog(page).getByRole("group", { name: "Цвет" }).getByRole("button");
  await expect(colors).toHaveCount(COLORS);
  await page.getByRole("button", { name: "Бирюзовый" }).click();
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.getByRole("button", { name: /^Бирюзовый объект/u })).toBeVisible();

  await page.reload();
  const color = await page.evaluate(async () => {
    const body = await fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json());
    return body.projects.find((one: { title: string }) => one.title === "Бирюзовый объект")?.color;
  });
  expect(color, "новый цвет не сохранился").toBe("teal");
});
