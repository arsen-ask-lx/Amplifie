import { bubbles, createChannel, register, say, seedHistory } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * ПОИСК ПО СООБЩЕНИЯМ (task-100, П-9). Написан ДО окна поиска и обязан
 * быть красным.
 *
 * Проверяется то, что видит человек: Ctrl+K, набор, строка выдачи с чатом
 * и подсвеченным словом, щелчок — сообщение в чате на экране. Число
 * запросов поиска при наборе — тоже поведение: пауза и отмена прежнего
 * запроса обещаны планом, и без них каждая буква стоила бы запроса.
 */

test.describe.configure({ timeout: 180_000 });

/** Окно поиска. */
function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Поиск по сообщениям" });
}

/** Считать запросы поиска, начиная с этой минуты. */
function countSearches(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes("/v1/search/messages")) count += 1;
  });
  return () => count;
}

async function openSearch(page: Page) {
  // Не из поля ввода: там у редактора свои сочетания, и окно обязано
  // открываться из любого места экрана.
  await page.getByRole("heading", { level: 2 }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog(page)).toBeVisible();
}

test("Ctrl+K находит сообщение по форме слова, подсвечивает и открывает его", async ({ page }) => {
  await register(page);
  await createChannel(page, "Сметы");
  const me = (await (await page.request.get("/v1/me")).json()) as {
    participant: { id: string; displayName: string };
  };
  await say(page, "подписали договоры с подрядчиком");
  await say(page, "обсудили кровлю");
  // Упоминание в строке выдачи — как в ленте, «@Имя», а не разметкой.
  const mention = `[${me.participant.displayName}](@${me.participant.id})`;
  await page.request.post(
    `/v1/conversations/${new URL(page.url()).pathname.split("/")[2]}/messages`,
    {
      data: { body: `договор у ${mention}`, clientMsgId: crypto.randomUUID() },
    },
  );

  await openSearch(page);
  const searches = countSearches(page);
  await dialog(page).getByRole("searchbox").pressSequentially("договор", { delay: 40 });

  const rows = dialog(page).getByRole("option");
  await expect(rows).toHaveCount(2);
  const signed = rows.filter({ hasText: "подписали" });
  await expect(signed).toContainText("Сметы");
  await expect(signed.locator("mark")).toHaveText("договор");
  await expect(rows.filter({ hasText: "договор у" })).toContainText(
    `@${me.participant.displayName}`,
  );
  expect(searches(), "каждая буква стоила запроса").toBeLessThanOrEqual(2);

  await signed.click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    bubbles(page).filter({ hasText: "подписали договоры с подрядчиком" }),
  ).toBeInViewport();
});

test("найденное в начале длинной истории открывается в чате", async ({ page, playwright }) => {
  await register(page);
  await createChannel(page, "Давнее");
  await seedHistory(page, playwright.request, 600);

  await openSearch(page);
  await dialog(page).getByRole("searchbox").pressSequentially("самая первая", { delay: 40 });
  const row = dialog(page).getByRole("option").filter({ hasText: "самая первая строка" });
  await expect(row).toBeVisible();

  await row.click();
  await expect(bubbles(page).filter({ hasText: "самая первая строка" })).toBeInViewport();
});

test("короткий запрос не ищет и подсказывает", async ({ page }) => {
  // Часы подделаны, чтобы пропустить паузу набора без сна: до прыжка идут как настоящие.
  await page.clock.install();
  await register(page);
  await openSearch(page);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/search/messages")) {
      asked.push(String((request.postDataJSON() as { q: string }).q));
    }
  });
  await dialog(page).getByRole("searchbox").pressSequentially("я", { delay: 40 });
  await expect(dialog(page).getByText("Введите хотя бы два знака")).toBeVisible();

  // ⚠️ «ЗАПРОСА НЕ БЫЛО» — ПОСЛЕ ПРИЗНАКА, ЧТО ПАУЗА ПРОШЛА И ПОИСК ЖИВ.
  // Прыжок часов дальше паузы набора (0,4 с): отложенный запрос по одной «я»,
  // будь он, ушёл бы здесь. Затем второй знак обязан дать запрос — и запрос
  // по «я» стоял бы в списке раньше него. Прежняя проверка «ноль» шла сразу
  // за подсказкой, до конца паузы, и прошла бы и на сломанном коде.
  await page.clock.fastForward(1_000);
  const searched = page.waitForRequest((request) => request.url().includes("/v1/search/messages"));
  await dialog(page).getByRole("searchbox").pressSequentially("а", { delay: 40 });
  await searched;
  expect(asked, "короткий запрос ушёл на сервер").toEqual(["яа"]);

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});
