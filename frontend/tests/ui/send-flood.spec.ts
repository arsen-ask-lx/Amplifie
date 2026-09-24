import { expect, type Page, test } from "@playwright/test";
import { bubble, createChannel, menu, openChannel, register, say, typeInto } from "./fixtures.js";

/**
 * РЕПЛИКИ НЕ ТЕРЯЮТСЯ ПРИ ЧАСТОЙ ОТПРАВКЕ (task-111, Д-52). Написан ДО кода
 * и обязан быть красным.
 *
 * Владелец 22.09: короткие реплики подряд после тридцатой за минуту встают
 * с «!» и не уходят до перезагрузки. Порог здесь НАСТОЯЩИЙ — `SEND`,
 * 30 в минуту на человека: подделка ответа 429 доказала бы, что клиент
 * понимает подделку, а не сервер. Каждый сценарий регистрирует своего
 * человека — порог по человеку, соседи его не делят.
 */

test.describe.configure({ timeout: 180_000 });

const SENT = 40;
/** Эту человек отменит, пока она ждёт за порогом. */
const CANCELLED = 38;
const kept = Array.from({ length: SENT }, (_, i) => i + 1).filter((n) => n !== CANCELLED);

/** «флуд 07» — с нулём: «флуд 1» нашёлся бы и внутри «флуд 10». */
const text = (n: number) => `флуд ${String(n).padStart(2, "0")}`;

/**
 * ⚠️ «НЕ УШЛО» ЛОВИТ НАБЛЮДАТЕЛЬ, А НЕ ПРОВЕРКА В КОНЦЕ. Метка, мелькнувшая
 * и погасшая, — та же поломка: человек её видел. Ищем по подписи
 * для чтения с экрана — её носит и значок, и кнопка повтора. Переходы
 * внутри приложения документ не меняют, и наблюдатель живёт весь сценарий.
 */
const WATCH = () => {
  const box = window as unknown as { amplifieNotSent: string[] };
  box.amplifieNotSent = [];
  new MutationObserver(() => {
    for (const node of document.querySelectorAll('[aria-label*="не ушло" i]')) {
      const said = node.closest("article")?.textContent ?? "?";
      if (!box.amplifieNotSent.includes(said)) box.amplifieNotSent.push(said);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true });
};

const notSentSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { amplifieNotSent: string[] }).amplifieNotSent);

/** Сколько раз сервер ответил на отправку отказом по частоте. */
function countRefusals(page: Page): { count: number } {
  const refused = { count: 0 };
  page.on("response", (response) => {
    const sending = response.request().method() === "POST" && response.url().endsWith("/messages");
    if (sending && response.status() === 429) refused.count += 1;
  });
  return refused;
}

/** Уйти в настройки и вернуться — переходом внутри приложения, без перезагрузки. */
async function visitSettings(page: Page): Promise<void> {
  await page.getByLabel("Профиль и настройки").click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  await expect(page).toHaveURL(/\/settings/u);
  await page.getByRole("link", { name: "Вернуться в приложение" }).click();
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
}

test("40 реплик подряд — дошли все, ни одного «!», даже если уйти в другой чат и в настройки", async ({
  page,
}) => {
  await register(page);
  await createChannel(page, "Соседний");
  await createChannel(page, "Флуд");
  const refused = countRefusals(page);
  await page.evaluate(WATCH);

  for (let n = 1; n <= SENT; n++) {
    // Две реплики за порогом — ответами на разные: цитата берётся
    // в момент набора, а не в момент, когда очередь дойдёт до реплики.
    if (n === 35) await menu(page, text(1), "Ответить");
    if (n === 36) await menu(page, text(2), "Ответить");
    await typeInto(page, text(n), "Отправить");
  }

  // Лента едет вниз за каждой своей репликой, и за ждущими тоже: одинаковый
  // номер у пачки черновиков оставлял новые под краем экрана (критик, 22.09).
  await expect(bubble(page, text(SENT))).toBeInViewport();

  // Ждущую за порогом можно не отправлять — и она не уйдёт, когда откроется окно.
  await menu(page, text(CANCELLED), "Не отправлять");
  await expect(bubble(page, text(CANCELLED))).toHaveCount(0);

  // Хвост ждёт окна сервера. Уходим — лента чата и сам экран чата
  // пропадают, а реплики обязаны уйти всё равно.
  await openChannel(page, "Соседний");
  await visitSettings(page);
  await openChannel(page, "Флуд");

  for (const n of kept) {
    // `first()`: «флуд 01» и «флуд 02» есть ещё и в цитатах 35-й и 36-й.
    await expect(bubble(page, text(n)).first().getByLabel("доставлено")).toBeVisible({
      timeout: 90_000,
    });
  }

  // Ноль — порог не задет, и сценарий доказывает не то. Больше двух —
  // очередь долбит, а не ждёт срока, названного сервером.
  expect(refused.count, "ответов 429 на отправку").toBeGreaterThanOrEqual(1);
  expect(refused.count, "ответов 429 на отправку").toBeLessThanOrEqual(2);
  expect(await notSentSeen(page)).toEqual([]);

  // Порядок и цитаты — по записи сервера: после перезагрузки черновиков нет.
  await page.reload();
  await expect(bubble(page, text(SENT)).getByLabel("доставлено")).toBeVisible();
  const order = (await page.locator("article").allTextContents())
    .map((one) => [...one.matchAll(/флуд \d\d/gu)].at(-1)?.[0])
    .filter((one): one is string => one !== undefined);
  expect(order).toEqual(kept.map(text));
  await expect(bubble(page, text(CANCELLED))).toHaveCount(0);
  await expect(bubble(page, text(35))).toContainText(text(1));
  await expect(bubble(page, text(36))).toContainText(text(2));
  await expect(bubble(page, text(36))).not.toContainText(text(1));
});

test("сеть пропала надолго — у реплики «!», щелчок отправляет её один раз", async ({
  page,
  context,
}) => {
  await register(page);
  await createChannel(page, "Соседний");
  await createChannel(page, "Обрыв");

  await context.setOffline(true);
  await typeInto(page, "долгий обрыв", "Отправить");
  await openChannel(page, "Соседний");
  // Терпение отправки — 30 с (`PATIENCE_MS`): отказ случается, пока
  // человек в другом чате, и лента «Обрыва» его не видит.
  await page.waitForTimeout(33_000);
  await context.setOffline(false);
  await openChannel(page, "Обрыв");

  const retry = bubble(page, "долгий обрыв").getByRole("button", {
    name: /повторить отправку/iu,
  });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(bubble(page, "долгий обрыв").getByLabel("доставлено")).toBeVisible();

  await page.reload();
  await expect(bubble(page, "долгий обрыв").getByLabel("доставлено")).toBeVisible();
  await expect(bubble(page, "долгий обрыв")).toHaveCount(1);
});

test("короткий обрыв переживается сам — реплика доходит без «!»", async ({ page }) => {
  await register(page);
  await createChannel(page, "Мигание");
  await page.evaluate(WATCH);

  // Первая отправка обрывается до сервера, остальные идут как есть.
  let cut = false;
  await page.route("**/v1/conversations/*/messages", async (route) => {
    if (route.request().method() === "POST" && !cut) {
      cut = true;
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });

  await say(page, "сквозь мигание");
  expect(cut, "обрыв не случился — сценарий доказывает не то").toBe(true);
  expect(await notSentSeen(page)).toEqual([]);
});
