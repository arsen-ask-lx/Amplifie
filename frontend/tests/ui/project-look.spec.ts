import { register, rowMenu } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

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

/** Готовых цветов — восемь; всё остальное берётся пипеткой (task-104). */
const PRESETS = 8;

/** Открыть поповер вида: значок-образец слева от названия. */
async function openLook(page: Page) {
  await page.getByRole("button", { name: "Значок и цвет проекта" }).click();
  await expect(page.getByRole("searchbox", { name: "Поиск значка" })).toBeVisible();
}

test("второе открытие «Нового проекта» — пустое окно, а не прежний проект", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Объект");
  await openLook(page);
  await page.getByRole("button", { name: "Портфель" }).click();
  await page.getByRole("button", { name: "Оранжевый" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(projectDialog(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Новый проект" }).click();
  await expect(page.getByLabel("Название проекта"), "окно помнит прежнее название").toHaveValue("");
  await openLook(page);
  await expect(
    page.getByRole("dialog").locator('[aria-pressed="true"]'),
    "окно помнит прежние значок и цвет",
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
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

test("свой цвет пипеткой доезжает до сервера, а поиск находит значок", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Свой цвет");
  await openLook(page);

  // Готовых цветов восемь — остальное берут пипеткой.
  const presets = page.getByRole("group", { name: "Цвет" }).getByRole("button");
  await expect(presets).toHaveCount(PRESETS + 1); // восемь цветов и «Без цвета»

  // Поиск словом: девяносто значков глазами не перебирают.
  await page.getByRole("searchbox", { name: "Поиск значка" }).fill("кран");
  await expect(page.getByRole("button", { name: "Кран" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Портфель" })).toHaveCount(0);
  await page.getByRole("button", { name: "Кран" }).click();

  await page.getByLabel("Свой цвет").fill("#3a7bd5");
  // Escape закрывает поповер, но не окно: слой закрывается по одному.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox", { name: "Поиск значка" })).toHaveCount(0);
  await expect(page.getByLabel("Название проекта")).toBeVisible();

  await page.getByRole("button", { name: "Создать проект" }).click();
  await expect(page.getByRole("button", { name: /^Свой цвет/u })).toBeVisible();

  await page.reload();
  const look = await page.evaluate(async () => {
    const body = await fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json());
    const own = body.projects.find((one: { title: string }) => one.title === "Свой цвет");
    return { color: own?.color ?? null, icon: own?.icon ?? null };
  });
  expect(look, "цвет из пипетки не сохранился").toEqual({ color: "#3a7bd5", icon: "crane" });
});

test("сервер принимает только цвет, а не имя", async ({ page }) => {
  await register(page, "Хозяин");
  const answers = await page.evaluate(async () => {
    const made = await fetch("/v1/projects", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Проверка" }),
    }).then((r) => r.json());
    const send = async (color: string) =>
      (
        await fetch(`/v1/projects/${made.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ color }),
        })
      ).status;
    return {
      name: await send("красный"),
      junk: await send("#zzz"),
      color: await send("#3a7bd5"),
    };
  });
  expect(answers.name, "сервер принял имя цвета").toBe(422);
  expect(answers.junk, "сервер принял не цвет").toBe(422);
  expect(answers.color, "сервер не принял настоящий цвет").toBe(200);
});
