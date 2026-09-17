import { expect, type Page, test } from "@playwright/test";
import {
  bubble,
  bubbles,
  createChannel,
  inviteToken,
  joinVoice,
  type Requests,
  register,
  say,
  seedHistory,
} from "./fixtures.js";

/**
 * ПЕРЕХОД К ДАВНЕМУ СООБЩЕНИЮ (task-099, П-4).
 *
 * Прежде лента листала назад не больше десяти страниц — пятьсот реплик, —
 * и цитата на давнее открывала чат без подсветки. Здесь история длиннее
 * этого предела, и цель лежит в самом её начале.
 *
 * ⚠️ ПОДСВЕТКУ ПРОВЕРЯЕМ ТЕМ, ЧТО ВИДИТ ЧЕЛОВЕК: цель на экране, а свежего
 * в ленте нет. Класс подсветки — разметка; «цель в видимой части и лента
 * не склеена с концом» — поведение.
 */

/** Заметно больше прежнего предела в 550 реплик (первая страница и десять назад). */
const SEEDED = 600;

const TARGET = "строка номер 10";
const QUOTING = "ответ на десятую";

test.describe.configure({ timeout: 240_000 });

/** Какой чат открыт — из адреса. */
function roomOf(page: Page): string {
  const room = new URL(page.url()).pathname.split("/")[2];
  if (!room) throw new Error("не понял, какой чат открыт");
  return room;
}

/** Номер и идентификатор реплики по точному тексту — у сервера, листая назад. */
async function messageAt(page: Page, room: string, body: string) {
  // `page.request` несёт печеньки вкладки: спрашиваем от имени того же человека.
  let before = "";
  for (;;) {
    const response = await page.request.get(
      `/v1/conversations/${room}/messages?limit=200${before}`,
    );
    const got = (await response.json()) as {
      items: { id: string; seq: number; body: string }[];
      hasMore: boolean;
    };
    const found = got.items.find((one) => one.body === body);
    if (found) return { id: found.id, seq: found.seq };
    const oldest = got.items[0];
    if (!got.hasMore || !oldest) throw new Error(`реплики «${body}» нет`);
    before = `&before=${oldest.seq}`;
  }
}

/**
 * Реплика по ТОЧНОМУ тексту: «строка номер 10» не должна находить сотую.
 *
 * ⚠️ И НЕ ДОЛЖНА НАХОДИТЬ ЦИТАТУ НА СЕБЯ. Ответ на десятую несёт её текст
 * в цитате и законно стоит в конце ленты — искавший просто по тексту
 * видел «давнее в свежей ленте» там, где его нет.
 */
function exactly(page: Page, text: string) {
  return bubbles(page).filter({
    has: page.getByText(text, { exact: true }),
    hasNot: page.getByTitle("Перейти к сообщению"),
  });
}

/** Считать запросы ленты этого чата, начиная с этой минуты. */
function countFeedRequests(page: Page, room: string): () => number {
  let count = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "GET" && url.includes(`/v1/conversations/${room}/messages`)) {
      count += 1;
    }
  });
  return () => count;
}

/** Непрочитанное открытого чата — как его считает сервер. */
async function unreadOf(page: Page, room: string): Promise<number> {
  return page.evaluate(async (room) => {
    const response = await fetch(`/v1/panel?open=${room}`, { credentials: "include" });
    return ((await response.json()) as { open: { unread: number } | null }).open?.unread ?? -1;
  }, room);
}

async function goToTarget(page: Page) {
  await bubble(page, QUOTING).getByTitle("Перейти к сообщению").click();
  await expect(exactly(page, TARGET)).toBeInViewport();
}

async function prepared(page: Page, requests: Requests) {
  await register(page);
  await createChannel(page, "Давнее");
  await seedHistory(page, requests, SEEDED);
  const room = roomOf(page);
  const target = await messageAt(page, room, TARGET);

  // Цитата на давнее — в конце ленты: с неё и начинается переход.
  await page.evaluate(
    async ({ room, replyToId, body }) => {
      await fetch(`/v1/conversations/${room}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, clientMsgId: crypto.randomUUID(), replyToId }),
      });
    },
    { room, replyToId: target.id, body: QUOTING },
  );
  await expect(bubble(page, QUOTING)).toBeVisible();
  return { room, target };
}

test("цитата на давнее из конца ленты открывает окно вокруг него, без дыры и без склейки", async ({
  page,
  playwright,
}) => {
  const { room } = await prepared(page, playwright.request);
  const feedRequests = countFeedRequests(page, room);

  // П-4.2: переход внутри открытого чата, лента в конце.
  await goToTarget(page);
  await expect(bubble(page, QUOTING), "окно вокруг давнего склеено с концом").toHaveCount(0);
  // П-4.1: два запроса ленты, а не листание назад страницами.
  expect(feedRequests(), "лента листалась назад, а не открылась вокруг цели").toBeLessThanOrEqual(
    2,
  );

  // П-4.3: чужое новое к давнему не прилипает, непрочитанное не гаснет.
  const colleague = await joinVoice(playwright.request, await inviteToken(page), "Коллега");
  const said = await colleague.post(`/v1/conversations/${room}/messages`, {
    data: { body: "свежее от коллеги", clientMsgId: crypto.randomUUID() },
  });
  expect(said.ok()).toBe(true);
  await expect(page.getByLabel("В конец ленты")).toBeVisible();
  // Отметка прочтения уходит окном в три секунды — ждём дольше окна.
  await page.waitForTimeout(4_000);
  await expect(bubble(page, "свежее от коллеги"), "новое прилипло к давнему").toHaveCount(0);
  expect(await unreadOf(page, room), "чтение давнего погасило непрочитанное").toBe(1);

  // П-4.4: «в конец» — к свежему.
  await page.getByLabel("В конец ленты").click();
  await expect(bubble(page, "свежее от коллеги")).toBeVisible();

  // П-4.5: «назад» из давнего — конец разговора.
  await goToTarget(page);
  await page.goBack();
  await expect(bubble(page, "свежее от коллеги")).toBeVisible();
  await expect(exactly(page, TARGET)).toHaveCount(0);

  // П-4.6: своя отправка из давнего уводит в конец.
  await goToTarget(page);
  await say(page, "моё из давнего");
  await expect(bubble(page, "свежее от коллеги")).toBeVisible();
  await expect(exactly(page, TARGET)).toHaveCount(0);

  await colleague.dispose();
});

test("ссылка на давнее открывает его сразу, а короткое окно догружается без прокрутки", async ({
  page,
  playwright,
}) => {
  const { room, target } = await prepared(page, playwright.request);

  // П-4.1: открыть адрес давнего сообщения с нуля.
  await page.goto(`/c/${room}/${target.seq}`);
  await expect(exactly(page, TARGET)).toBeInViewport();

  // П-4.7: высокий экран и цель в самом начале — окна не хватает на прокрутку.
  const first = await messageAt(page, room, "самая первая строка");
  await page.setViewportSize({ width: 1440, height: 4000 });
  await page.goto(`/c/${room}/${first.seq}`);
  await expect(exactly(page, "самая первая строка")).toBeVisible();
  await expect.poll(() => bubbles(page).count(), { timeout: 15_000 }).toBeGreaterThan(51);
});
