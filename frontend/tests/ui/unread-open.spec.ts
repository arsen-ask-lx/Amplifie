import {
  chatWithUnread,
  createChannel,
  inviteToken,
  joinVoice,
  panelRow,
  register,
  unreadIn,
} from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * НЕПРОЧИТАННОЕ КАК В TELEGRAM (task-107). Написан ДО кода и обязан быть
 * красным.
 *
 * Жалоба владельца 17.09: «счётчик непрочитанных моргает и исчезает сразу
 * при открытии чата, а не как в тг — пока я не прочту». Здесь проверяется
 * ровно это: чат открывается НА ЧЕРТЕ, а число убывает по мере чтения.
 *
 * ⚠️ НЕПРОЧИТАННОЕ БЫВАЕТ ТОЛЬКО ЧУЖОЕ (Р-029), поэтому реплики пишет
 * второй человек через свою корзинку печенек, а не вторая вкладка.
 */

test.describe.configure({ timeout: 180_000 });

const SENT = 40;

test("чат открывается на первом непрочитанном, а не в конце", async ({ page, playwright }) => {
  await chatWithUnread(page, playwright.request, "Смета", SENT);

  await panelRow(page, "Смета").click();

  // ⚠️ ЧЕРТА НА ЭКРАНЕ, А КОНЕЦ ЧАТА — НЕТ. Иначе человек открывает чат
  // внизу и «читает» то, чего не видел.
  await expect(page.getByText("Непрочитанные сообщения")).toBeInViewport();
  // По номеру, а не по тексту: «реплика 1» — начало и «реплики 10…19».
  await expect(page.locator('article[data-seq="1"]')).toContainText("чужая реплика 1");
  await expect(page.locator('article[data-seq="1"]')).toBeInViewport();
  // ⚠️ ТОЧНЫЙ ТЕКСТ, А НЕ ПОДСТРОКА. Текст пузыря склеен со временем:
  // ночью «чужая реплика 4» + «02:51» даёт «…реплика 402:51», и поиск
  // «реплика 40» находил четвёртую (поймано прогоном в 02:50, 22.09).
  await expect(page.getByText(`чужая реплика ${SENT}`, { exact: true })).not.toBeInViewport();
});

test("число убывает по мере чтения, а не гаснет разом", async ({ page, playwright }) => {
  await chatWithUnread(page, playwright.request, "Смета", SENT);

  // Следим за строкой панели: «0» до того, как человек долистал, — это и есть
  // то самое моргание.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { seenCounts: number[] }).seenCounts = seen;
    new MutationObserver(() => {
      const row = [...document.querySelectorAll("button")].find((one) =>
        (one.textContent ?? "").startsWith("Смета"),
      );
      const found = /непрочитанных:\s*(\d+)/u.exec(row?.textContent ?? "");
      seen.push(found?.[1] === undefined ? 0 : Number(found[1]));
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  await panelRow(page, "Смета").click();
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  // Часть увидена — число меньше исходного, но не ноль.
  await expect
    .poll(async () => await unreadIn(page, "Смета"), { message: "число не убавилось" })
    .toBeLessThan(SENT);
  const afterOpen = await unreadIn(page, "Смета");
  expect(afterOpen, "число погасло целиком при открытии").toBeGreaterThan(0);

  /**
   * Дочитали до конца — число исчезло.
   *
   * ⚠️ ЛИСТАЕМ, ПОКА НЕ КОНЧИТСЯ, А НЕ ОДНИМ ПРЫЖКОМ. Окно ленты вокруг
   * непрочитанного кончается раньше конца чата: остальное догружается
   * по мере подхода к низу — ровно как у человека.
   */
  await expect
    .poll(
      async () => {
        await page.getByRole("log").evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        return await unreadIn(page, "Смета");
      },
      { timeout: 40_000, message: "число не догасло до конца" },
    )
    .toBeNull();

  // И ни разу до этого не показывался ноль при живом непрочитанном.
  const counts = await page.evaluate(
    () => (window as unknown as { seenCounts: number[] }).seenCounts,
  );
  const zeroTooEarly = counts.indexOf(0);
  const lastPositive = counts
    .map((one, at) => (one > 0 ? at : -1))
    .reduce((a, b) => Math.max(a, b));
  expect(
    zeroTooEarly === -1 || zeroTooEarly > lastPositive,
    "число показывало ноль, пока непрочитанное ещё было",
  ).toBe(true);
});

test("реплика выше экрана становится прочитанной, когда долистал до её конца", async ({
  page,
  playwright,
}) => {
  /**
   * ⚠️ ПОЙМАНО ВЛАДЕЛЬЦЕМ 26.09: «прочитал всё, а горит 8». Реплика считалась
   * увиденной, только когда видна ЦЕЛИКОМ, а длинная целиком не помещается
   * на экран никогда — отметка застревала перед первой такой навсегда.
   */
  await page.setViewportSize({ width: 900, height: 500 });
  await register(page);
  await createChannel(page, "Простыня");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  await createChannel(page, "Другой");

  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  const Long = 3;
  for (let n = 1; n <= Long; n += 1) {
    const said = await guest.post(`/v1/conversations/${room}/messages`, {
      data: { body: `простыня ${n} ${"слово ".repeat(500)}`, clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok(), `реплика ${n} не ушла`).toBe(true);
  }
  await guest.dispose();
  await expect.poll(async () => await unreadIn(page, "Простыня")).toBe(Long);

  await panelRow(page, "Простыня").click();

  // Сервер, а не значок: значок склеен ещё и с отметками в памяти вкладки.
  const serverUnread = async () => {
    const list = (await page.evaluate(() =>
      fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json()),
    )) as { items: Array<{ title: string; unread: number }> };
    return list.items.find((one) => one.title === "Простыня")?.unread;
  };

  await expect
    .poll(
      async () => {
        await page.getByRole("log").evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        return await serverUnread();
      },
      { timeout: 20_000, message: "дочитанные длинные реплики остались непрочитанными" },
    )
    .toBe(0);
});
