import { expect, type Page, test } from "@playwright/test";
import { createChannel, invited, openChannel, register, say } from "./fixtures.js";

/**
 * СЦЕНАРИИ ПРОЕКТОВ (Р-032, task-035).
 *
 * ⚠️ ПРОЕКТ — ЭТО МЕСТО, ГДЕ ЧАТ РОЖДАЕТСЯ, а не папка, куда его потом
 * перекладывают. Разница не косметическая: «завести канал, потом
 * отнести» заставляет человека решать, о чём был разговор, ПОСЛЕ
 * разговора. Владелец показал устройство Codex и назвал верный порядок —
 * сперва называют дело, потом говорят о нём.
 *
 * Перекладывание при этом остаётся: чат может переехать. Оно просто
 * перестало быть единственным путём.
 *
 * Бьёт по собранному образу. Перед запуском: make up
 */

function канал(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

function папка(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Завести проект плюсом в разделе «Проекты» — нашим окном, не браузерным. */
async function завестиПроект(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill(title);
  await page.getByLabel("Название проекта").press("Enter");
  await expect(папка(page, title)).toBeVisible();
}

/** Действие из меню проекта. */
async function вМенюПроекта(page: Page, project: string, пункт: string): Promise<void> {
  await page.getByRole("button", { name: `Что сделать с проектом «${project}»` }).click();
  await page.getByRole("menuitem", { name: пункт }).click();
}

test("в панели только проекты — раздела «Каналы» нет", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗАДАЧИ (task-037). Разделов в панели ровно
   * столько, сколько СОРТОВ разговора; «Каналы» сортом не были — они
   * были вторым домом для того же чата, и человеку приходилось решать,
   * канал у него или чат проекта.
   */
  await expect(page.getByRole("button", { name: "Проекты" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Каналы" }),
    "раздел «Каналы» остался в панели",
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Новый канал" }),
    "канал всё ещё можно завести вне проекта",
  ).toHaveCount(0);

  // Регистрация даёт живое место: домашняя папка и чат внутри неё.
  await expect(папка(page, "Общее"), "после регистрации нет домашней папки").toBeVisible();
  await expect(канал(page, "Общий"), "после регистрации нет ни одного чата").toBeVisible();
});

test("чат заводится ВНУТРИ проекта, а не снаружи", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  // Кнопка живёт внутри развёрнутой папки — там, где человек уже смотрит.
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового канала").fill("Смета");
  await page.getByLabel("Название нового канала").press("Enter");

  await expect(канал(page, "Смета")).toBeVisible();

  /**
   * ⚠️ ПРОВЕРЯЕМ ПРИНАДЛЕЖНОСТЬ, А НЕ КАРТИНКУ. «Виден в панели» — слабое
   * утверждение: он виден и снаружи проекта. Настоящее свойство одно —
   * чат отнесён к проекту, и его говорит сервер.
   */
  const принадлежность = await page.evaluate(async () => {
    const ответ = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const чат = ответ.items.find((one: { title: string }) => one.title === "Смета");
    const проект = ответ.projects.find((one: { title: string }) => one.title === "Объект");
    return { чат: чат?.projectId ?? null, проект: проект?.id ?? null };
  });
  expect(принадлежность.чат, "чат завели внутри проекта, а он оказался снаружи").toBe(
    принадлежность.проект,
  );
});

test("проект переименовывается, и это видно во второй вкладке", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового канала").fill("Смета");
  await page.getByLabel("Название нового канала").press("Enter");
  await expect(папка(другой, "Объект")).toBeVisible();

  await вМенюПроекта(page, "Объект", "Переименовать");
  await page.getByLabel("Название проекта").fill("Второй объект");
  await page.getByLabel("Название проекта").press("Enter");

  await expect(папка(page, "Второй объект")).toBeVisible();
  await expect(папка(другой, "Второй объект"), "переименование не доехало").toBeVisible();
});

test("убрать проект — в вопросе названо, сколько чатов уйдёт", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового канала").fill("Смета");
  await page.getByLabel("Название нового канала").press("Enter");
  await openChannel(page, "Смета");
  await say(page, "важные слова");

  await вМенюПроекта(page, "Объект", "Убрать проект");

  /**
   * ⚠️ ЦЕНА НАЖАТИЯ НАЗВАНА ЧИСЛОМ. Прежде здесь проверялось обратное —
   * «чаты останутся»: пока домов было два, папка уносила только себя.
   * Дом остался один (task-037), и то же нажатие уносит переписку.
   * Слово «убрать» этого не передаёт, число передаёт.
   */
  await expect(
    page.getByText(/и 1 чат внутри/u),
    "вопрос не сказал, сколько чатов уйдёт вместе с папкой",
  ).toBeVisible();
  await page.getByRole("button", { name: "Убрать" }).click();

  await expect(папка(page, "Объект"), "проект остался в панели").toHaveCount(0);
  await expect(канал(page, "Смета"), "чат пережил свою папку и стал невидимкой").toHaveCount(0);
});

test("свёрнутый проект показывает, что внутри новое", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await openChannel(другой, "Общий");

  await завестиПроект(page, "Объект");
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  await openChannel(page, "Смета");

  await say(page, "первая реплика");
  await say(page, "вторая реплика");

  /**
   * ⚠️ КОЛЛЕГА СМОТРИТ В ДРУГОЙ ЧАТ И СВОРАЧИВАЕТ ПАПКУ. Открой он
   * «Смету» — сработали бы три условия отметки (Р-029), всё погасло бы,
   * и проверять стало бы нечего.
   */
  const свёрток = папка(другой, "Объект");
  await expect(свёрток).toBeVisible();
  await expect(канал(другой, "Смета"), "чат проекта не виден развёрнутым").toBeVisible();

  await свёрток.click();
  await expect(канал(другой, "Смета"), "проект свернулся, а чат остался на виду").toBeHidden();
  await expect(
    свёрток,
    "свёрнутая папка молчит о новом — сворачивать её никто не станет",
  ).toHaveAccessibleName(/непрочитанных: 2/u);
});
