import { bubble, createChannel, login, openChannel, register, say } from "./fixtures.js";
import { type Browser, expect, type Page, test } from "./guard.js";

/**
 * Поток живых обновлений переживает отказ (task-093, срез 1).
 *
 * ⚠️ ОТКАЗ ПОДСТАВЛЯЕТСЯ ПЕРЕХВАТОМ ДВЕРИ ПОТОКА, А НЕ ОСТАНОВКОЙ СЕРВЕРА.
 * Живыми остановками это прожито дважды (журнал task-093): Caddy отвечает
 * 502, пока `api` лежит, и `EventSource` закрывается навсегда. Здесь тот же
 * ответ приходит от перехвата — быстро, детерминированно и без того, чтобы
 * ронять стенд под соседними сценариями. Остальное — настоящий сервер.
 *
 * ⚠️ ОТКАЗ ТОЛЬКО У ПЕРВОЙ ВКЛАДКИ. Вторая пишет по живому потоку, и её
 * реплика обязана доехать до первой уже после того, как отказ снят.
 */

/** Вторая вкладка того же человека в том же канале. */
async function writer(browser: Browser, person: Parameters<typeof login>[1]): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await login(page, person);
  await openChannel(page, "Обрыв");
  return page;
}

test("поток получил 502 — вкладка не глохнет и получает следующую реплику", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.route("**/v1/stream", (route) => route.fulfill({ status: 502, body: "" }));

  const person = await register(page);
  await createChannel(page, "Обрыв");

  const other = await writer(browser, person);
  await say(other, "пока сервер лежал");
  await page.unroute("**/v1/stream");

  await expect(
    bubble(page, "пока сервер лежал"),
    "вкладка не вернулась к потоку после 502 — живые обновления умерли до перезагрузки",
  ).toBeVisible({ timeout: 45_000 });

  await other.context().close();
});

test("связь вернулась, в чате тишина — пропущенное приезжает догоном после подключения", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.route("**/v1/stream", (route) => route.abort("connectionreset"));

  const person = await register(page);
  await createChannel(page, "Обрыв");

  const other = await writer(browser, person);
  await say(other, "пока связи не было");

  // Порядок запросов — чтобы сценарий не прошёл по чужой причине: реплику
  // обязан привезти догон ПОСЛЕ нового подключения, а не что-то постороннее.
  const order: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/v1/stream")) order.push("поток");
    else if (url.includes("/v1/sync")) order.push("догон");
  });
  await page.unroute("**/v1/stream");

  await expect(
    bubble(page, "пока связи не было"),
    "связь восстановилась, а пропущенная реплика так и не приехала",
  ).toBeVisible({ timeout: 45_000 });

  const connected = order.indexOf("поток");
  expect(connected, "после снятия отказа вкладка не подключилась к потоку").toBeGreaterThanOrEqual(
    0,
  );
  expect(order.slice(connected), "реплику привёз не догон после подключения").toContain("догон");

  await other.context().close();
});

test("сессии больше нет — вкладка показывает вход, а не крутит попытки", async ({ page }) => {
  await register(page);
  // Лента обязана встать на курсор: догон до её загрузки не ходит нарочно.
  await createChannel(page, "Выход");
  await say(page, "до выхода");

  // Настоящий отказ, а не подставленный: печеньки нет — сервер сам
  // отвечает 401. Возврат во вкладку — один из поводов догнать.
  let attempts = 0;
  page.on("request", (request) => {
    if (request.url().includes("/v1/stream") || request.url().includes("/v1/sync")) attempts += 1;
  });
  await page.context().clearCookies();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(
    page.getByText("Сеанс закончился", { exact: false }),
    "кончившаяся сессия не привела на вход",
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Войти|Создать/u })).toBeVisible();

  const seen = attempts;
  await page.waitForTimeout(3_000);
  expect(attempts, "после 401 вкладка продолжила ломиться в поток").toBe(seen);
});
