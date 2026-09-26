import { bubble, createChannel, register, say } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * Короткий сбой сервера — повод подождать, а не ошибка до перезагрузки (task-096).
 *
 * ⚠️ СБОЙ ПОДСТАВЛЯЕТСЯ ПЕРЕХВАТОМ ДВЕРИ, А НЕ ОСТАНОВКОЙ СЕРВЕРА — тем же
 * приёмом, что `reconnect.spec.ts`: быстро, по счёту запросов и без падения
 * стенда под соседними сценариями.
 *
 * ⚠️ СЛУЧАЙНОСТЬ ВКЛАДКИ ПОДМЕНЕНА. Паузы повтора становятся известными
 * числами (1, 2, 4, 8… секунд), и сценарии не зависят от удачи разброса.
 *
 * ⚠️ ОШИБКУ СЛУШАЕМ ВСЁ ВРЕМЯ СЦЕНАРИЯ, А НЕ ТОЛЬКО В КОНЦЕ. Строка, которая
 * появилась и погасла, для человека уже была — проверка одного итогового
 * кадра прошла бы по чужой причине.
 */

const FEED_FAILURE = "Не удалось загрузить сообщения";

async function steadyRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.999;
  });
}

/** Появится ли строка за это время. */
function appears(page: Page, text: string, ms: number): Promise<boolean> {
  return page
    .getByText(text)
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(
      () => true,
      () => false,
    );
}

/** Первые `times` запросов, подходящих под условие, получают отказ; дальше — настоящий сервер. */
async function failFirst(
  page: Page,
  pattern: string,
  times: number,
  status: number,
  only: (url: URL, method: string) => boolean = () => true,
): Promise<{ count: () => number }> {
  let seen = 0;
  await page.route(pattern, (route) => {
    const request = route.request();
    if (!only(new URL(request.url()), request.method())) return route.continue();
    seen += 1;
    if (seen > times) return route.continue();
    return route.fulfill({ status, contentType: "application/json", body: '{"error":"сбой"}' });
  });
  return { count: () => seen };
}

/** Первая страница ленты — не отправка и не листание назад. */
const firstPage = (url: URL, method: string) =>
  method === "GET" && url.pathname.endsWith("/messages") && !url.searchParams.has("before");

test("сбой «кто я» при открытии страницы — чат, а не экран входа", async ({ page }) => {
  await steadyRandom(page);
  await register(page);
  const me = await failFirst(page, "**/v1/me", 2, 503);

  await page.reload();

  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(me.count(), "«кто я» не повторялся — страница ушла на вход").toBe(3);
});

test("сбой первой страницы ленты — лента видна, ошибки не было", async ({ page }) => {
  await steadyRandom(page);
  await register(page);
  await createChannel(page, "Лента");
  await say(page, "первая");
  const feed = await failFirst(page, "**/v1/conversations/*/messages*", 1, 503, firstPage);

  await page.reload();
  const failed = appears(page, FEED_FAILURE, 6000);
  await expect(bubble(page, "первая")).toBeVisible({ timeout: 10_000 });

  expect(await failed, "короткий сбой показан ошибкой ленты").toBe(false);
  expect(feed.count(), "первая страница не повторялась").toBe(2);
});

test("отказ догона сразу после ленты не выдаётся за отказ ленты", async ({ page }) => {
  await steadyRandom(page);
  await register(page);
  await createChannel(page, "Догон");
  await say(page, "есть");
  const syncs = await failFirst(page, "**/v1/sync*", 1, 503);

  await page.reload();
  const failed = appears(page, FEED_FAILURE, 6000);
  await expect(bubble(page, "есть")).toBeVisible({ timeout: 10_000 });

  expect(await failed, "отказ догона показан как «не удалось загрузить сообщения»").toBe(false);
  await expect.poll(() => syncs.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
});

test("проект заведён, а панель не перечиталась — окно закрывается без ошибки", async ({ page }) => {
  await register(page);
  await page.route("**/v1/panel*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"сбой"}' }),
  );

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Смета");
  await page.getByLabel("Название проекта").press("Enter");

  await expect(
    page.getByLabel("Название проекта"),
    "окно не закрылось: удачная запись показана неудачей",
  ).toBeHidden({ timeout: 2000 });

  const projects = await page.evaluate(async () => {
    const list = await fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json());
    return (list.projects as Array<{ title: string }>).filter((one) => one.title === "Смета")
      .length;
  });
  expect(projects, "проект завёлся не один раз").toBe(1);
});

test("сбой порции раскрытой папки — её чаты остаются на экране", async ({ page }) => {
  await register(page);
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Объект");
  await page.getByLabel("Название проекта").press("Enter");
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового чата").fill("Смета");
  await page.getByLabel("Название нового чата").press("Enter");
  const row = page.getByRole("button", { name: /^Смета/ });
  await expect(row).toBeVisible();
  // Открыт другой чат: строка «Сметы» живёт только в порции папки, а не
  // в строке открытого чата, — иначе проверка прошла бы по чужой причине.
  await createChannel(page, "Снаружи");

  await page.route("**/v1/projects/*/conversations*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"сбой"}' }),
  );
  // Возврат во вкладку перечитывает панель — тот же путь, что после разрыва.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(3000);

  await expect(row, "чаты папки пропали из-за сбоя одной порции").toBeVisible();
});

test("долгий сбой ленты — строка с «Повторить», и одно нажатие собирает ленту", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await steadyRandom(page);
  await register(page);
  await createChannel(page, "Долгий");
  await say(page, "дождались");
  await failFirst(page, "**/v1/conversations/*/messages*", 1000, 503, firstPage);

  await page.reload();
  await expect(page.getByText(FEED_FAILURE)).toBeVisible({ timeout: 45_000 });
  const retry = page.getByRole("button", { name: "Повторить" });
  await expect(retry).toBeVisible();

  await page.unroute("**/v1/conversations/*/messages*");
  await retry.click();
  await expect(bubble(page, "дождались")).toBeVisible();
  await expect(page.getByText(FEED_FAILURE)).toBeHidden();
});

test("беда живых обновлений и отказ ленты — две строки, а не одна", async ({ page }) => {
  test.setTimeout(150_000);
  await steadyRandom(page);
  await register(page);
  await createChannel(page, "Две беды");
  await say(page, "ждёт");
  await failFirst(page, "**/v1/conversations/*/messages*", 1000, 503, firstPage);
  // Поток отказывает с самой загрузки: своя беда появится после трёх отказов.
  // Уже открытый поток перехват не рвёт, поэтому перехват — до перезагрузки.
  await page.route("**/v1/stream", (route) => route.fulfill({ status: 502, body: "" }));

  await page.reload();
  const trouble = page.getByText("Обновления не доходят — пробуем снова");
  await expect(trouble).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(FEED_FAILURE)).toBeVisible({ timeout: 45_000 });

  await expect(
    trouble,
    "отказ ленты затёр беду живых обновлений: строка одна на двоих",
  ).toBeVisible();

  // Поток вернулся — его беда гаснет, а отказ ленты с «Повторить» остаётся.
  await page.unroute("**/v1/stream");
  await expect(trouble).toBeHidden({ timeout: 45_000 });
  await expect(
    page.getByText(FEED_FAILURE),
    "погасшая беда живых обновлений стёрла и ошибку ленты",
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
});
