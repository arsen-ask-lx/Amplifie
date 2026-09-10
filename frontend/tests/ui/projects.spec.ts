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

test("чаты без папки лежат сверху, отдельного раздела для них нет", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗАДАЧИ (task-037). Раздела «Каналы» нет —
   * второго СОРТА чатов не бывает. Но и в папку чат никто не загоняет:
   * бездомные лежат простым списком сверху, как несортированные каналы
   * в Дискорде и недавние чаты в Claude.
   *
   * Почему не наоборот (папка обязательна) — Р-033: проект скоро
   * получит своего агента и свою память, и сваленное в общую папку
   * испортит ответы молча.
   */
  await expect(
    page.getByRole("button", { name: "Каналы" }),
    "раздел «Каналы» остался в панели",
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Новый чат", exact: true }),
    "чат негде завести без папки",
  ).toBeVisible();

  // Чат регистрации лежит сверху, а не внутри выдуманной папки.
  await expect(канал(page, "Общий")).toBeVisible();
  await expect(папка(page, "Общее"), "завелась папка-свалка").toHaveCount(0);
});

test("чат уходит из папки наверх и возвращается обратно", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового канала").fill("Смета");
  await page.getByLabel("Название нового канала").press("Enter");
  await expect(канал(page, "Смета")).toBeVisible();

  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Убрать из проекта" }).click();

  const снаружи = await page.evaluate(async () => {
    const ответ = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    return ответ.items.find((one: { title: string }) => one.title === "Смета")?.projectId ?? null;
  });
  expect(снаружи, "чат не вышел из папки — а выйти ему теперь есть куда").toBeNull();
  await expect(канал(page, "Смета"), "вышедший из папки чат пропал из панели").toBeVisible();
});

test("у проектов свой раздел и свой плюс", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ РАЗДЕЛ «ПРОЕКТЫ» ВИДЕН ВСЕГДА, ДАЖЕ ПУСТОЙ, И ЭТО ОТСТУПЛЕНИЕ
   * ОТ ПЛАНА. План обещал: у кого проектов нет — панель как прежде.
   * При сборке выяснилось, что тогда первый проект нечем завести:
   * плюс живёт в заголовке раздела, а раздела нет. Прятать вход
   * от того, у кого ещё ничего нет, — значит прятать саму возможность.
   * Цена отступления — одна строка заголовка; у Codex этот раздел
   * тоже стоит всегда.
   */
  const пусто = page.getByText("Проектов нет. Заведите первый — плюс в заголовке.");
  await expect(пусто, "пустой раздел проектов не объясняет себя").toBeVisible();

  await завестиПроект(page, "Объект");

  await expect(пусто, "подсказка осталась при заведённом проекте").toHaveCount(0);
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

test("убрать проект — переписка цела и лежит снаружи", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового канала").fill("Смета");
  await page.getByLabel("Название нового канала").press("Enter");
  await openChannel(page, "Смета");
  await say(page, "важные слова");

  await вМенюПроекта(page, "Объект", "Убрать проект");
  // ⚠️ СПРАШИВАЕМ, И В ВОПРОСЕ СКАЗАНО, ЧТО ЧАТЫ ОСТАНУТСЯ. Иначе слово
  // «убрать» человек прочтёт как «удалить переписку».
  await expect(page.getByText(/чаты останутся/u)).toBeVisible();
  await page.getByRole("button", { name: "Убрать" }).click();

  await expect(папка(page, "Объект"), "проект остался в панели").toHaveCount(0);
  await expect(канал(page, "Смета"), "чат исчез вместе с папкой").toBeVisible();
  await openChannel(page, "Смета");
  await expect(page.getByText("важные слова"), "переписка пропала").toBeVisible();
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
