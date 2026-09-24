import { expect, type Page, type Request, test } from "@playwright/test";
import {
  bubble,
  createChannel,
  inviteToken,
  joinVoice,
  openChannel,
  register,
  say,
  unreadIn,
} from "./fixtures.js";

/**
 * Возврат в дочитанный чат показывает переписку в том же кадре (task-114).
 *
 * ⚠️ ОТВЕТ ЛЕНТЫ ЗАДЕРЖИВАЕТСЯ НАРОЧНО. На пустом стенде сервер успевает
 * ответить до первого кадра, и признак измерил бы скорость машины, а не код.
 * Семьсот миллисекунд — столько же, сколько задерживает панель соседний
 * сценарий `jump-calm.spec.ts`, и по той же причине: порядок задаём сами.
 *
 * ⚠️ НАБЛЮДАТЕЛЬ СВОЙ, А НЕ ГОТОВЫЙ. Тот, что живёт в `jump-calm.spec.ts`,
 * считает ПОЯВЛЕНИЯ узла ленты, и на любом переключении даёт плюс один
 * из-за ключа; пропажу ленты он не видит вовсе. Здесь нужен ровно
 * обратный счёт — кадры, в которых ленты нет или она пуста.
 */

/** Что наблюдатель записал за время перехода. */
interface Frame {
  /** Узел ленты есть на странице. */
  log: boolean;
  /** Сколько реплик в нём нарисовано. */
  count: number;
  /** Сколько черт «Непрочитанные сообщения» на экране. */
  lines: number;
  /** Искомый текст виден в ленте. Пустая метка — никогда. */
  has: boolean;
}

declare global {
  interface Window {
    watchFrames?: Frame[];
    watchRaf?: number;
  }
}

const WATCH = (marker: string) => {
  window.watchFrames = [];
  const tick = () => {
    const log = document.querySelector('[role="log"]');
    window.watchFrames?.push({
      log: log !== null,
      count: log ? log.querySelectorAll("article").length : 0,
      lines: document.querySelectorAll("[data-unread-line]").length,
      has: marker !== "" && (log?.textContent ?? "").includes(marker),
    });
    window.watchRaf = requestAnimationFrame(tick);
  };
  tick();
};

const STOP = () => {
  if (window.watchRaf !== undefined) cancelAnimationFrame(window.watchRaf);
  return window.watchFrames ?? [];
};

/** Столько сервер держит ответ ленты, прежде чем ответить по-настоящему. */
const FEED_MS = 700;

/** Столько висит звонок, который в этом сценарии не должен дойти вовсе. */
const SILENCE_MS = 120_000;

/** Сколько кадров без ленты — с пояснением, которое читается в отчёте. */
function emptyOf(frames: Frame[]): number {
  return frames.filter((one) => !one.log || one.count === 0).length;
}

/**
 * Три чата одного человека: А дочитан тремя своими репликами, Б и В — по одной,
 * открыт В.
 *
 * ⚠️ ТРИ, А НЕ ДВА, И СОСЕДИ НЕПУСТЫЕ. У пустого канала ленты не существует
 * вовсе — на её месте приглашение написать первое сообщение, и узла
 * `role="log"` нет. Наблюдатель считал бы эти кадры пустыми, хотя переход
 * ещё не начался: первая редакция сценария так и краснела, пять кадров
 * из восьми, на исправном коде. Третий чат нужен затем, что снимков
 * к мигу возврата уже два — и возврат обязан взять свой.
 */
async function threeChats(page: Page): Promise<string> {
  await register(page, "Ходящий");
  await createChannel(page, "Смета");
  await say(page, "первая");
  await say(page, "вторая");
  await say(page, "третья");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  await createChannel(page, "Договор");
  await say(page, "договорная");
  await createChannel(page, "Планы");
  await say(page, "межевание");
  return room;
}

/** Сервер отвечает лентой не раньше чем через `FEED_MS` — с этого мига и меряем. */
async function slowFeed(page: Page): Promise<void> {
  await page.route("**/v1/conversations/*/messages**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, FEED_MS));
    await route.continue();
  });
}

test("П-1, П-1а, П-6 возврат в дочитанный чат: ни пустого кадра, ни черты, ни чужого", async ({
  page,
}) => {
  await threeChats(page);
  await slowFeed(page);

  // Метка — реплика СОСЕДНЕГО чата, у которого снимок тоже есть. В чате,
  // откуда уходим, её нет, поэтому любой кадр с ней — просочившийся чужой.
  await page.evaluate(WATCH, "договорная");
  await openChannel(page, "Смета");
  await expect(bubble(page, "третья")).toBeVisible();
  const frames = await page.evaluate(STOP);

  const empty = emptyOf(frames);
  expect(empty, `кадров без ленты: ${empty} из ${frames.length}`).toBe(0);

  // П-6: чужое не просвечивает ни на одном кадре.
  const leaked = frames.filter((one) => one.has).length;
  expect(leaked, `кадров с чужой репликой: ${leaked} из ${frames.length}`).toBe(0);

  // П-1а: у дочитанного чата черты быть не может. Подсадка «снимок несёт
  // только реплики» красит именно это: `readSeq` возьмётся от соседа, и черта
  // встанет над всей перепиской.
  //
  // ⚠️ ПРОВЕРЯЕТСЯ СОСТОЯНИЕ, А НЕ КАДРЫ. Наблюдатель включается ДО щелчка
  // и первые кадры записывает у покинутого чата — черта в них принадлежит
  // ему, а не переходу.
  await expect(page.locator("[data-unread-line]"), "черта у дочитанного чата").toHaveCount(0);
});

test("П-2 чат с непрочитанным открывается как сегодня: пустое место, потом черта", async ({
  page,
  playwright,
}) => {
  test.setTimeout(60_000);
  const room = await threeChats(page);

  // ⚠️ НЕПРОЧИТАННОЕ БЫВАЕТ ТОЛЬКО ЧУЖОЕ (Р-029): пишет второй человек.
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  for (const text of ["чужая первая", "чужая вторая", "чужая третья"]) {
    const said = await guest.post(`/v1/conversations/${room}/messages`, {
      data: { body: text, clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok(), `реплика «${text}» не ушла`).toBe(true);
  }
  await guest.dispose();
  await expect.poll(async () => await unreadIn(page, "Смета")).toBe(3);

  await slowFeed(page);
  await page.evaluate(WATCH, "");
  await openChannel(page, "Смета");
  await expect(bubble(page, "чужая третья")).toBeVisible();
  const frames = await page.evaluate(STOP);

  // Защита требования спеки, а не достижение: у чата с непрочитанным снимок
  // не показывается, и пустое место на время ответа остаётся сегодняшним.
  const empty = emptyOf(frames);
  expect(empty, `кадров без ленты: ${empty} из ${frames.length}`).toBeGreaterThan(0);
  await expect(page.locator("[data-unread-line]"), "черта у чата с непрочитанным").toHaveCount(1);
});

test("П-2а опоздавшее число: снимок показан, но черта всё равно встаёт", async ({
  page,
  playwright,
}) => {
  test.setTimeout(60_000);

  /**
   * ⚠️ ЗВОНОК НЕ ДОХОДИТ ВОВСЕ — ИМЕННО ЭТО И ПРОВЕРЯЕТСЯ. Число
   * непрочитанного в панели живёт звонком (`useLiveUpdates`), других
   * поводов перечитать панель нет. Без звонка оно остаётся нулём, и вкладка
   * честно не знает, что в чате уже есть чужое. Ровно этот случай —
   * медленная сеть — и опасен: снимок показывается, а черта обязана
   * появиться, когда приедет страница.
   *
   * Поток вешается ДО входа: он открывается при загрузке страницы,
   * и позже перехватывать нечего.
   */
  await page.route("**/v1/stream**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    await route.abort();
  });

  const room = await threeChats(page);
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  for (const text of ["чужая первая", "чужая вторая", "чужая третья"]) {
    const said = await guest.post(`/v1/conversations/${room}/messages`, {
      data: { body: text, clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok(), `реплика «${text}» не ушла`).toBe(true);
  }
  await guest.dispose();

  // Число опоздало — панель по-прежнему считает чат дочитанным.
  expect(await unreadIn(page, "Смета"), "панель узнала о чужом раньше времени").toBe(null);

  await slowFeed(page);
  await page.evaluate(WATCH, "");
  await openChannel(page, "Смета");
  await expect(bubble(page, "чужая третья")).toBeVisible();
  const frames = await page.evaluate(STOP);

  // Снимок показался: по числу из панели чат дочитан.
  const empty = emptyOf(frames);
  expect(empty, `кадров без ленты: ${empty} из ${frames.length}`).toBe(0);

  // И всё-таки черта встала — её принесла страница, а не панель.
  await expect(
    page.locator("[data-unread-line]"),
    "черта не встала, хотя страница привезла чужое",
  ).toHaveCount(1);
});

test("П-3 удалённая реплика живёт не дольше одного ответа", async ({ page, playwright }) => {
  test.setTimeout(60_000);
  const room = await threeChats(page);

  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  const said = await guest.post(`/v1/conversations/${room}/messages`, {
    data: { body: "пропадёт", clientMsgId: crypto.randomUUID() },
  });
  expect(said.ok(), "реплика соседа не ушла").toBe(true);
  const doomed = ((await said.json()) as { id: string }).id;

  // Прочитать чат и уйти из него: только так реплика попадает в снимок.
  await openChannel(page, "Смета");
  await expect(bubble(page, "пропадёт")).toBeVisible();
  await expect.poll(async () => await unreadIn(page, "Смета")).toBe(null);
  await openChannel(page, "Планы");

  const gone = await guest.delete(`/v1/messages/${doomed}`);
  expect(gone.ok(), "сосед не смог удалить свою реплику").toBe(true);
  await guest.dispose();

  await slowFeed(page);
  await openChannel(page, "Смета");

  // ⚠️ СНАЧАЛА «ВИДНА», ПОТОМ «ИСЧЕЗЛА», И ПОРЯДОК ВАЖЕН. Одна проверка
  // «её нет» прошла бы и в тот миг, когда снимок ещё не нарисован, —
  // то есть по чужой причине. Это названная цена задачи, и спека её
  // описывает: устаревшая реплика видна, пока летит ответ.
  await expect(bubble(page, "пропадёт"), "снимок не показал удалённую реплику").toBeVisible();
  await expect(bubble(page, "пропадёт"), "удалённая пережила ответ сервера").toHaveCount(0);
});

test("П-7 цена не выросла: возврат по снимку стоит одного похода за лентой", async ({ page }) => {
  await threeChats(page);

  // Сначала А и Б открываются обычным путём — снимки к возврату уже есть.
  await openChannel(page, "Смета");
  await expect(bubble(page, "третья")).toBeVisible();
  await openChannel(page, "Планы");
  await expect(bubble(page, "межевание")).toBeVisible();

  const trips: string[] = [];
  const count = (request: Request) => {
    if (request.method() !== "GET") return;
    if (/\/v1\/conversations\/[^/]+\/messages/u.test(request.url())) trips.push(request.url());
  };
  page.on("request", count);

  await openChannel(page, "Смета");
  await expect(bubble(page, "третья")).toBeVisible();
  page.off("request", count);

  // ⚠️ РОВНО ОДИН, И «НЕ БОЛЬШЕ» ЗДЕСЬ НЕ ГОДИТСЯ. Снимок — это память
  // вкладки, и он не имеет права ни добавить похода (тогда возврат
  // подорожал), ни отменить его (тогда правки и удаления, случившиеся
  // без нас, не доехали бы никогда).
  expect(trips.length, `походов за лентой на возврат: ${trips.length} — ${trips.join(", ")}`).toBe(
    1,
  );
});
