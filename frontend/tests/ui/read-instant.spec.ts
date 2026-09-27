import { chatWithUnread, panelRow, unreadIn } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * ЧИСЛО НЕПРОЧИТАННОГО НЕ ЖДЁТ СЕРВЕРА (task-108). Написан ДО кода
 * и обязан быть красным.
 *
 * Владелец 21.09: «листаю вниз, и только через секунду уменьшается счётчик —
 * в тг как будто в 10 раз быстрее». Число на экране сдвигалось ответом
 * на отметку, а отметка уходит не чаще раза в 3 с. Здесь ответ придерживается
 * на 5 с: если число убыло раньше — оно не ждёт сервера.
 */

test.describe.configure({ timeout: 180_000 });

const SENT = 40;

/** Отметки `/read`: номер и время ухода. */
function readMarksOf(page: Page): { seq: number; at: number }[] {
  const seen: { seq: number; at: number }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/read")) {
      seen.push({ seq: Number((request.postDataJSON() as { seq: number }).seq), at: Date.now() });
    }
  });
  return seen;
}

/** Номер последней реплики чата — по записи сервера. */
async function lastSeqOf(page: Page, room: string): Promise<number> {
  const answer = await page.request.get(`/v1/conversations/${room}/messages`);
  expect(answer.status(), "лента чата не прочиталась").toBe(200);
  const { items } = (await answer.json()) as { items: { seq: number }[] };
  const last = items.at(-1)?.seq;
  if (last === undefined) throw new Error("в чате нет реплик — сценарий доказывает не то");
  return last;
}

/**
 * Дождаться, что ушла отметка на последнюю реплику. Это признак, что окно
 * в 3 с прошло и отложенного не осталось, — вместо сна «на окно с запасом».
 */
async function lastMarkSent(marks: { seq: number }[], last: number): Promise<void> {
  await expect
    .poll(() => Math.max(0, ...marks.map((one) => one.seq)), {
      timeout: 10_000,
      message: "отметка на последнюю реплику не ушла",
    })
    .toBe(last);
}

/** Долистать ленту до конца, догружая, пока число не погаснет. */
async function readToEnd(page: Page, title: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.getByRole("log").evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        return await unreadIn(page, title);
      },
      { timeout: 40_000, message: "число не догасло до конца" },
    )
    .toBeNull();
}

test("число убывает сразу, хотя ответ на отметку ещё в пути", async ({ page, playwright }) => {
  await chatWithUnread(page, playwright.request, "Смета", SENT);

  // Ответ на отметку придержан на 5 с: число, дождавшееся его, опоздает.
  await page.route("**/v1/conversations/*/read", async (route) => {
    await new Promise((done) => setTimeout(done, 5000));
    await route.continue();
  });

  await panelRow(page, "Смета").click();
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  await expect
    .poll(async () => await unreadIn(page, "Смета"), {
      timeout: 1500,
      message: "число ждёт ответа сервера",
    })
    .toBeLessThan(SENT);
});

test("оборванная отметка уходит снова тем же номером", async ({ page, playwright }) => {
  const room = await chatWithUnread(page, playwright.request, "Смета", SENT);
  const last = await lastSeqOf(page, room);
  const marks = readMarksOf(page);

  // Все отметки обрываются, пока человек дочитывает до конца.
  await page.route("**/v1/conversations/*/read", (route) => route.abort());
  await panelRow(page, "Смета").click();
  await readToEnd(page, "Смета");
  // Окно в 3 с: последняя, самая дальняя отметка уходит и обрывается.
  await lastMarkSent(marks, last);

  // Сеть вернулась. Человек чуть сдвинул ленту в пределах уже увиденного:
  // нового номера нет — уйти обязан тот же, иначе отметка потеряна навсегда.
  await page.unroute("**/v1/conversations/*/read");
  const before = marks.length;
  await page.getByRole("log").evaluate((node) => {
    node.scrollTop -= 120;
  });
  await page.getByRole("log").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  await expect
    .poll(() => marks.slice(before).some((one) => one.seq === last), {
      timeout: 8000,
      message: "оборванная отметка потерялась",
    })
    .toBe(true);
});

test("число покинутого чата не загорается снова, пока ответ в пути", async ({
  page,
  playwright,
}) => {
  await chatWithUnread(page, playwright.request, "Смета", SENT);
  await panelRow(page, "Смета").click();
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  // Ответы придержаны: число на экране — только наша поправка. Перед тем
  // как отпустить первый ответ, страница узнаёт, что окно «в пути» кончилось:
  // дальше наблюдатель не пишет — вопрос теста только про время в пути.
  await page.route("**/v1/conversations/*/read", async (route) => {
    await new Promise((done) => setTimeout(done, 5000));
    await page.evaluate(() => {
      (window as unknown as { answerLanded: boolean }).answerLanded = true;
    });
    await route.continue();
  });
  await page.getByRole("log").evaluate((node) => {
    node.scrollTop += node.clientHeight;
  });
  await expect.poll(async () => await unreadIn(page, "Смета")).toBeLessThan(SENT);
  const shown = (await unreadIn(page, "Смета")) ?? 0;

  // Следим за строкой «Сметы» с момента перехода в другой чат.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { leftCounts: number[] }).leftCounts = seen;
    new MutationObserver(() => {
      if ((window as unknown as { answerLanded?: boolean }).answerLanded) return;
      const row = [...document.querySelectorAll("button")].find((one) =>
        (one.textContent ?? "").startsWith("Смета"),
      );
      const found = /непрочитанных:\s*(\d+)/u.exec(row?.textContent ?? "");
      seen.push(found?.[1] === undefined ? 0 : Number(found[1]));
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await panelRow(page, "Другой").click();
  // Признак конца окна — первый придержанный ответ отпущен (см. `route` выше).
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { answerLanded?: boolean }).answerLanded),
      {
        timeout: 15_000,
        message: "придержанная отметка так и не ушла",
      },
    )
    .toBe(true);

  const counts = await page.evaluate(
    () => (window as unknown as { leftCounts: number[] }).leftCounts,
  );
  expect(
    Math.max(0, ...counts),
    "число покинутого чата выросло после перехода",
  ).toBeLessThanOrEqual(shown);
  // Ещё придержанные ответы не должны дёргать закрывающуюся страницу.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("отметки — пачкой: между соседними не меньше 3 с, номера растут", async ({
  page,
  playwright,
}) => {
  const room = await chatWithUnread(page, playwright.request, "Смета", SENT);
  const last = await lastSeqOf(page, room);
  const marks = readMarksOf(page);

  await panelRow(page, "Смета").click();
  await readToEnd(page, "Смета");
  await lastMarkSent(marks, last);

  expect(marks.length, "ни одной отметки — отправка сломана").toBeGreaterThan(1);
  for (let at = 1; at < marks.length; at += 1) {
    const gap = (marks[at]?.at ?? 0) - (marks[at - 1]?.at ?? 0);
    // Окно — 3000 мс литералом из Р-029, а не `READ_WINDOW_MS` из кода:
    // тест обязан покраснеть, если окно в коде сузят. 300 мс — допуск
    // на таймеры браузера: меряем снаружи, временем прихода запроса.
    expect(gap, "отметки чаще раза в 3 с").toBeGreaterThanOrEqual(3000 - 300);
    expect(marks[at]?.seq ?? 0, "номера отметок не растут").toBeGreaterThan(
      marks[at - 1]?.seq ?? 0,
    );
  }
});
