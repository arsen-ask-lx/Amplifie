import { expect, type Page, test } from "@playwright/test";
import { createChannel, invited, openChannel, register, say } from "./fixtures.js";

/**
 * СЦЕНАРИИ ПРОЕКТОВ (Р-032, task-034).
 *
 * Проверяют то, чего приёмочная по протоколу не видит:
 *   ① чат действительно переезжает в папку и обратно — глазами человека,
 *      через меню, а не через ручку;
 *   ② СВЁРНУТАЯ папка говорит числами. Это главное в её пользе: свернул
 *      и ослеп — значит сворачивать никто не станет, и второй уровень
 *      панели окажется мёртвым.
 *
 * Бьёт по собранному образу. Перед запуском: make up
 */

function канал(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Переложить чат через меню трёх точек. */
async function вПроект(page: Page, channel: string, куда: string): Promise<void> {
  await page.getByRole("button", { name: `Что сделать с каналом «${channel}»` }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: куда, exact: true }).click();
}

test("чат переезжает в проект и возвращается обратно", async ({ page }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");

  // Заводим проект прямо из меню чата: папку заводят, когда есть что
  // в неё положить.
  page.once("dialog", (диалог) => void диалог.accept("Объект"));
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Новый проект…" }).click();

  const папка = page.getByRole("button", { name: /^Объект/ });
  await expect(папка, "проект не появился в панели").toBeVisible();
  await expect(канал(page, "Смета"), "чат пропал из панели вместе с переездом").toBeVisible();

  await вПроект(page, "Смета", "Убрать из проекта");
  await expect(канал(page, "Смета")).toBeVisible();
});

test("свёрнутый проект показывает, что внутри новое", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await openChannel(другой, "Общий");

  page.once("dialog", (диалог) => void диалог.accept("Объект"));
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Новый проект…" }).click();
  await expect(page.getByRole("button", { name: /^Объект/ })).toBeVisible();

  // Хозяин говорит в «Смете», коллега этого не видел.
  await openChannel(page, "Смета");
  await say(page, "первая реплика");
  await say(page, "вторая реплика");

  /**
   * ⚠️ КОЛЛЕГА СМОТРИТ В ДРУГОЙ ЧАТ И СВОРАЧИВАЕТ ПАПКУ. Открой он
   * «Смету» — сработали бы три условия отметки (Р-029), всё погасло бы,
   * и проверять стало бы нечего.
   */
  const папка = другой.getByRole("button", { name: /^Объект/ });
  await expect(папка).toBeVisible();
  await expect(канал(другой, "Смета"), "чат проекта не виден развёрнутым").toBeVisible();

  await папка.click();
  await expect(канал(другой, "Смета"), "проект свернулся, а чат остался на виду").toBeHidden();
  await expect(
    папка,
    "свёрнутая папка молчит о новом — сворачивать её никто не станет",
  ).toHaveAccessibleName(/непрочитанных: 2/u);

  await папка.click();
  await expect(канал(другой, "Смета"), "проект не развернулся обратно").toBeVisible();
});
