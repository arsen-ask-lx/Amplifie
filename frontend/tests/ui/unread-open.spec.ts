import { expect, type Page, type PlaywrightWorkerArgs, test } from "@playwright/test";
import { bubbles, createChannel, inviteToken, joinVoice, register } from "./fixtures.js";

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

/** Строка чата в панели: у неё же живёт число непрочитанного. */
function row(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`, "u") });
}

/** Число непрочитанного в строке панели; `null` — числа нет. */
async function unread(page: Page, title: string): Promise<number | null> {
  const text = (await row(page, title).textContent()) ?? "";
  const found = /непрочитанных:\s*(\d+)/u.exec(text);
  return found?.[1] === undefined ? null : Number(found[1]);
}

/** Завести чат, набить его чужими репликами и вернуться в другой чат. */
async function chatWithUnread(page: Page, playwright: PlaywrightWorkerArgs["playwright"]) {
  await register(page);
  await createChannel(page, "Смета");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  // Открыт другой чат: в открытом реплики стали бы прочитанными сразу.
  await createChannel(page, "Другой");

  /**
   * ⚠️ ДВА ГОЛОСА, А НЕ ОДИН. Порог отправки — тридцать реплик в минуту
   * на человека (Р-025): сорок от одного упираются в него, и половина
   * не доходит. Оживлённый чат оживлён числом людей, а не скоростью одного.
   */
  const token = await inviteToken(page);
  for (const [voice, from] of [
    [1, 1],
    [2, 1 + SENT / 2],
  ] as const) {
    const guest = await joinVoice(playwright.request, token, `Сосед ${voice}`);
    for (let n = from; n < from + SENT / 2; n += 1) {
      const said = await guest.post(`/v1/conversations/${room}/messages`, {
        data: { body: `чужая реплика ${n}`, clientMsgId: crypto.randomUUID() },
      });
      expect(said.ok(), `реплика ${n} не ушла`).toBe(true);
    }
    await guest.dispose();
  }
  await expect.poll(async () => await unread(page, "Смета")).toBe(SENT);
  return room;
}

test("чат открывается на первом непрочитанном, а не в конце", async ({ page, playwright }) => {
  await chatWithUnread(page, playwright);

  await row(page, "Смета").click();

  // ⚠️ ЧЕРТА НА ЭКРАНЕ, А КОНЕЦ ЧАТА — НЕТ. Иначе человек открывает чат
  // внизу и «читает» то, чего не видел.
  await expect(page.getByText("Непрочитанные сообщения")).toBeInViewport();
  // По номеру, а не по тексту: «реплика 1» — начало и «реплики 10…19».
  await expect(page.locator('article[data-seq="1"]')).toContainText("чужая реплика 1");
  await expect(page.locator('article[data-seq="1"]')).toBeInViewport();
  await expect(bubbles(page).filter({ hasText: `чужая реплика ${SENT}` })).not.toBeInViewport();
});

test("число убывает по мере чтения, а не гаснет разом", async ({ page, playwright }) => {
  await chatWithUnread(page, playwright);

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

  await row(page, "Смета").click();
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  // Часть увидена — число меньше исходного, но не ноль.
  await expect
    .poll(async () => await unread(page, "Смета"), { message: "число не убавилось" })
    .toBeLessThan(SENT);
  const afterOpen = await unread(page, "Смета");
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
        return await unread(page, "Смета");
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
