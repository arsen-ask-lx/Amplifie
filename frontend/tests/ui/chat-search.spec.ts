import { bubbles, createChannel, register, say } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * ПОИСК ВНУТРИ ЧАТА (task-106). Написан ДО кода и обязан быть красным.
 *
 * Решение владельца 17.09 «как в Telegram, оба»: лупа и Ctrl+F ищут
 * в открытом чате со счётчиком «3 из 17» и стрелками, Ctrl+K остаётся
 * общим поиском. Главное требование сверх вида — **бесшовность**: ход
 * стрелками по попаданиям, которые уже в окне ленты, не должен ни
 * перезагружать ленту, ни мигать.
 */

test.describe.configure({ timeout: 180_000 });

/** Полоса поиска в чате. */
function bar(page: Page) {
  return page.getByRole("search", { name: "Поиск в чате" });
}

/** Сколько реплик подсветилось вспышкой — считаем запуски анимации. */
async function watchFlashes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { flashes: 0, feedPages: 0 };
    (window as unknown as { seen: typeof seen }).seen = seen;
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "found") seen.flashes += 1;
    });
  });
}

function seen(page: Page) {
  return page.evaluate(() => (window as unknown as { seen: { flashes: number } }).seen);
}

test("Ctrl+F ищет в открытом чате: счётчик, стрелки, Escape", async ({ page }) => {
  await register(page);
  await createChannel(page, "Смета");
  for (const text of ["договор на кровлю", "договор на фундамент", "просто текст"]) {
    await say(page, text);
  }

  // ⚠️ НЕ ИЗ ПОЛЯ ВВОДА: там Ctrl+F у редактора не занят, но окно обязано
  // открываться с любого места экрана.
  await page.getByRole("heading", { level: 2 }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(bar(page)).toBeVisible();

  await bar(page).getByRole("searchbox").fill("договор");

  // Счётчик Telegram: «какой по счёту из сколького». Свежие сверху, поэтому
  // первым идёт «договор на фундамент».
  await expect(bar(page)).toContainText("1 из 2");
  await expect(bubbles(page).filter({ hasText: "договор на фундамент" })).toBeInViewport();

  await bar(page).getByRole("button", { name: "Следующее совпадение" }).click();
  await expect(bar(page)).toContainText("2 из 2");
  await expect(bubbles(page).filter({ hasText: "договор на кровлю" })).toBeInViewport();

  await bar(page).getByRole("button", { name: "Предыдущее совпадение" }).click();
  await expect(bar(page)).toContainText("1 из 2");

  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
});

test("ход по попаданиям в окне ленты не перезагружает её и не мигает дважды", async ({ page }) => {
  await register(page);
  await createChannel(page, "Смета");
  for (let n = 1; n <= 12; n += 1) await say(page, `строка ${n} про договор`);

  await page.getByRole("heading", { level: 2 }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await bar(page).getByRole("searchbox").fill("договор");
  await expect(bar(page)).toContainText("1 из 12");

  // Считаем запросы ленты и вспышки подсветки с этого мгновения.
  let feedRequests = 0;
  page.on("request", (request) => {
    if (/\/v1\/conversations\/[^/]+\/messages/u.test(request.url())) feedRequests += 1;
  });
  await watchFlashes(page);

  const next = bar(page).getByRole("button", { name: "Следующее совпадение" });
  for (let step = 0; step < 3; step += 1) await next.click();
  await expect(bar(page)).toContainText("4 из 12");
  await page.waitForTimeout(1500);

  // ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ СРЕЗА. Все двенадцать реплик уже в окне ленты,
  // значит стрелка — это прокрутка и подсветка, а не новая загрузка.
  expect(feedRequests, "лента перезагружается на каждый шаг стрелки").toBe(0);
  const flashes = (await seen(page)).flashes;
  expect(flashes, "вспышек не по одной на шаг").toBe(3);
});

test("лупа — переключатель: второе нажатие закрывает поиск (владелец 26.09)", async ({ page }) => {
  await register(page, "Переключающий");
  await createChannel(page, "Лупа");
  const lens = page.getByRole("button", { name: "Поиск в этом чате" });

  await lens.click();
  await expect(bar(page)).toBeVisible();
  await expect(lens).toHaveAttribute("aria-pressed", "true");

  await lens.click();
  await expect(bar(page), "второе нажатие на лупу не закрыло поиск").toHaveCount(0);
  await expect(lens).toHaveAttribute("aria-pressed", "false");
});

test("найденное слово подсвечено в реплике, полоса закрылась — подсветки нет (владелец 26.09)", async ({
  page,
}) => {
  await register(page, "Ищущий слово");
  await createChannel(page, "Подсветка");
  await say(page, "подписали Договоры с поставщиком");
  await say(page, "просто текст");

  await page.getByRole("button", { name: "Поиск в этом чате" }).click();
  await bar(page).getByRole("searchbox").fill("договор");
  await expect(bar(page)).toContainText("1 из 1");

  // Подсветка браузера — не разметка: смотрим, ЧТО именно она красит.
  const lit = () =>
    page.evaluate(() => {
      const found = CSS.highlights.get("search-found");
      return found ? [...found].map((range) => range.toString()) : [];
    });
  await expect.poll(lit, { message: "найденное слово не подсвечено" }).toEqual(["Договор"]);

  await page.keyboard.press("Escape");
  await expect.poll(lit, { message: "полоса закрылась, а подсветка осталась" }).toEqual([]);
});
