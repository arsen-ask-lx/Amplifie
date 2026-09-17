import { expect, type Page, test } from "@playwright/test";
import {
  createChannel,
  field,
  inviteToken,
  joinVoice,
  openChannel,
  register,
  say,
} from "./fixtures.js";

/**
 * ПЕРЕХОД БЕЗ МИГАНИЯ (task-101). Написан ДО правки и обязан быть красным.
 *
 * Владелец на показе 17.09: страница уезжает вверх, подсветка гаснет
 * и загорается снова, при открытии чата мелькает «Загружаем…». Замер
 * нашёл три причины; каждая красит свой признак:
 * - П-1: документ выше окна — подписи счётчиков в панели вылезают
 *   из оболочки экрана;
 * - П-2: лента создаётся дважды — снятие середины на загрузку и ключ
 *   ленты по строке панели, которой у чата из поиска сначала нет;
 * - П-3: надпись «Загружаем» и снятое на время загрузки поле ввода.
 *
 * ⚠️ ПОДСВЕТКУ СЧИТАЕМ ПО ЗАПУСКУ АНИМАЦИИ `found`, А НЕ ПО КЛАССУ. Человек
 * видит именно вспышку: пересозданная лента запускает её заново, и это
 * ровно то «потухло и опять загорелось».
 */

test.describe.configure({ timeout: 180_000 });

/** Сколько чатов обгоняют давний: первая порция панели — 25 строк. */
const FRESHER = 26;
const TARGET = "давняя реплика про кровлю";

/** Завести чаты запросами от имени вкладки. Возвращает идентификаторы. */
async function channels(page: Page, count: number): Promise<string[]> {
  return page.evaluate(async (n) => {
    const ids: string[] = [];
    for (let i = 1; i <= n; i += 1) {
      const response = await fetch("/v1/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `Свежий ${i}` }),
      });
      ids.push(((await response.json()) as { id: string }).id);
    }
    return ids;
  }, count);
}

/**
 * Наблюдатель за экраном: вспышки подсветки, новые узлы ленты, надпись
 * «Загружаем» и снятие поля ввода — с этой минуты.
 */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { flashes: 0, feeds: 0, loadingText: 0, emptyText: 0, fieldGone: 0 };
    (window as unknown as { seen: typeof seen }).seen = seen;
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "found") seen.flashes += 1;
    });
    const feedNow = () => document.querySelector('[role="log"]');
    const fieldNow = () => document.querySelector('[aria-label="Текст сообщения"]') !== null;
    let feed = feedNow();
    let hadField = fieldNow();
    new MutationObserver((records) => {
      const added = records.flatMap((record) => [...record.addedNodes]);
      const saying = (text: string) => added.filter((node) => node.textContent?.includes(text));
      seen.loadingText += saying("Загружаем").length;
      seen.emptyText += saying("Здесь пока пусто").length;
      const now = feedNow();
      if (now && now !== feed) seen.feeds += 1;
      feed = now;
      const hasField = fieldNow();
      if (hadField && !hasField) seen.fieldGone += 1;
      hadField = hasField;
    }).observe(document.body, { subtree: true, childList: true });
  });
}

function seen(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          seen: Record<"flashes" | "feeds" | "loadingText" | "emptyText" | "fieldGone", number>;
        }
      ).seen,
  );
}

test("переход из поиска: страница на месте, одна вспышка, без «Загружаем»", async ({
  page,
  playwright,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await register(page);
  await createChannel(page, "Давний");
  await say(page, TARGET);

  // Свежие чаты с чужой репликой: у каждого счётчик в панели, и давний
  // выпадает из первой порции — его строки у панели нет.
  const fresh = await channels(page, FRESHER);
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  for (const id of fresh) {
    const said = await guest.post(`/v1/conversations/${id}/messages`, {
      data: { body: "есть вопрос", clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok()).toBe(true);
  }
  await guest.dispose();

  await page.goto(`/c/${fresh[0]}`);
  await expect(field(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Свежий 26/u })).toBeVisible();

  // П-1: страница сама по себе не прокручивается — прокручиваются лента и панель.
  const tall = await page.evaluate(() => ({
    page: document.scrollingElement?.scrollHeight ?? 0,
    window: window.innerHeight,
  }));
  expect
    .soft(tall.page, "документ выше окна — страницу можно прокрутить мимо ленты")
    .toBeLessThanOrEqual(tall.window);

  // ⚠️ ПАНЕЛЬ ОТВЕЧАЕТ ПОЗЖЕ ЛЕНТЫ — КАК НА БОЛЬШОЙ БАЗЕ. На засеве строка
  // чата приезжала через 55 мс после ленты; на пустом стенде панель
  // успевает раньше, и пересоздание ленты не случается вовсе. Порядок
  // задаём сами, иначе признак зависит от скорости машины.
  await page.route("**/v1/panel**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await watch(page);
  await page.getByRole("heading", { level: 2 }).click();
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Поиск по сообщениям" });
  await dialog.getByRole("searchbox").pressSequentially("кровлю", { delay: 40 });
  await dialog.getByRole("option").filter({ hasText: TARGET }).click();

  await expect(page.locator("article").filter({ hasText: TARGET })).toBeInViewport();
  await expect(page.getByRole("heading", { level: 2, name: "Давний" })).toBeVisible();
  // Вспышка длится около секунды; повторная прежде приходила через десятки мс.
  await page.waitForTimeout(3000);

  const afterJump = await seen(page);
  // П-1 после перехода: шапка на экране, документ не сдвинут.
  expect.soft(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);
  await expect.soft(page.getByRole("heading", { level: 2, name: "Давний" })).toBeInViewport();
  // П-2: одна лента — одна вспышка.
  expect.soft(afterJump.flashes, "подсветка загорелась не один раз").toBe(1);
  expect.soft(afterJump.feeds, "лента создана не один раз").toBe(1);
  // П-3: ни надписи, ни снятого поля ввода.
  expect.soft(afterJump.loadingText, "мелькнуло «Загружаем»").toBe(0);
  expect.soft(afterJump.fieldGone, "поле ввода снималось на загрузку").toBe(0);
  // У непустого чата приглашение «напишите первое» — ложь, даже на кадр.
  expect.soft(afterJump.emptyText, "мелькнуло «Здесь пока пусто»").toBe(0);

  // П-3 обычным щелчком по чату в панели.
  await openChannel(page, "Свежий 3");
  await expect(page.getByRole("heading", { level: 2, name: "Свежий 3" })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "есть вопрос" })).toHaveCount(1);
  const afterOpen = await seen(page);
  expect.soft(afterOpen.loadingText, "мелькнуло «Загружаем» при открытии").toBe(0);
  expect.soft(afterOpen.fieldGone, "поле ввода снималось при открытии").toBe(0);
  expect.soft(afterOpen.emptyText, "мелькнуло «Здесь пока пусто» при открытии").toBe(0);
});
