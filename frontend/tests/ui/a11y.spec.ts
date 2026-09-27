import AxeBuilder from "@axe-core/playwright";
import { createChannel, menu, register, say } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * ДОСТУПНОСТЬ ГЛАВНЫХ ЭКРАНОВ (task-121, Д-43): axe-core по правилам WCAG 2.1 A и AA.
 *
 * Автоматическая проверка не заменяет ручной проход клавиатурой и читалкой —
 * она ловит механическое: подписи полей и кнопок, контраст, роли, порядок
 * заголовков. Клавиатура в окнах — `forward-find.spec.ts` (Tab держится внутри).
 *
 * Исключений нет. Появится нарушение, которое нельзя починить сразу, — оно
 * вписывается сюда поимённо с причиной, и список только убывает.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page, where: string): Promise<void> {
  const report = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = report.violations.map(
    (one) =>
      `${one.id} (${one.impact}): ${one.nodes.map((node) => node.target.join(" ")).join("; ")}`,
  );
  expect(found, `нарушения доступности — ${where}`).toEqual([]);
}

test("вход, чат, настройки и окна — без нарушений WCAG 2.1 A/AA", async ({ page }) => {
  await page.goto("/");
  await violations(page, "экран входа");

  await register(page, "Проверяющий доступность");
  await createChannel(page, "Смета");
  await say(page, "реплика для проверки");
  await violations(page, "чат");

  await menu(page, "реплика для проверки", "Переслать");
  await expect(page.getByRole("dialog", { name: "Переслать" })).toBeVisible();
  await violations(page, "окно «Переслать»");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+KeyK");
  await expect(page.getByRole("dialog", { name: "Поиск по сообщениям" })).toBeVisible();
  await violations(page, "окно поиска");
  await page.keyboard.press("Escape");

  for (const section of ["agents", "appearance"]) {
    await page.goto(`/settings/${section}`);
    await violations(page, `настройки: ${section}`);
  }
});
