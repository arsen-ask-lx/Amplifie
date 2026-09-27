import { createChannel, menu, register, say } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * ПОЛИТИКА СОДЕРЖИМОГО НЕ ЛОМАЕТ ПРОДУКТ (task-118, П-3).
 *
 * CSP включается сразу блокирующей, без режима «только отчёт»: принимать
 * отчёты некому. Вместо отчётов — этот путь и полный набор интерфейсных
 * сценариев под той же политикой. Нарушение ловится событием браузера
 * `securitypolicyviolation`: оно приходит, даже когда страница «вроде
 * работает», а запрещённое тихо не случилось.
 *
 * ⚠️ СНАЧАЛА ПРОВЕРЯЕТСЯ, ЧТО ПОЛИТИКА ВООБЩЕ ЕСТЬ. Ноль нарушений без
 * политики — это ноль потому, что нарушать нечего.
 */

test.describe.configure({ timeout: 120_000 });

test("сквозной путь под политикой содержимого — ни одного нарушения", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspSeen: string[] }).cspSeen = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ← ${event.blockedURI || "встроенное"}`);
    });
  });
  const seen = () => page.evaluate(() => (window as unknown as { cspSeen: string[] }).cspSeen);

  const first = await page.request.get("/");
  expect(first.headers()["content-security-policy"], "политики нет — проверять нечего").toContain(
    "script-src 'self'",
  );

  await register(page, "Под политикой");
  await createChannel(page, "Проверка политики");
  await say(page, "жирно и код под политикой");

  // Окна Radix ставят свои стили — главный кандидат на нарушение.
  await menu(page, "под политикой", "Переслать");
  await expect(page.getByRole("dialog", { name: "Переслать" })).toBeVisible();
  await page.keyboard.type("пров", { delay: 10 });
  await expect(
    page.getByRole("dialog", { name: "Переслать" }).getByRole("option").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Поиск по сообщениям" })).toBeVisible();
  await page.keyboard.type("жирно", { delay: 10 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await menu(page, "под политикой", "Удалить");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Профиль и настройки").click();
  await page.keyboard.press("Escape");

  // Шрифт расширенной кириллицы Vite вшил в CSS как `data:` — без
  // `font-src data:` «ґ» и «₴» тихо падали бы на запасной шрифт.
  const glyphs = await page.evaluate(async () => {
    const faces = await document.fonts.load('16px "Unbounded Variable"', "ґ₴");
    return faces.length;
  });
  expect(glyphs, "шрифт с «ґ» и «₴» не загрузился").toBeGreaterThan(0);

  expect(await seen(), "политика запретила то, чем продукт пользуется").toEqual([]);
});
