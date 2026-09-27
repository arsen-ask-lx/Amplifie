import { bubble, createChannel, invited, openChannel, register } from "./fixtures.js";
import { type Browser, expect, type Page, test } from "./guard.js";

/**
 * Вкладка ходит на сервер по делу, а прочитанное остаётся прочитанным (task-097).
 *
 * ⚠️ СЧИТАЕМ ЗАПРОСЫ И СМОТРИМ НА ЧИСЛО НА ЭКРАНЕ, А НЕ ТОЛЬКО НА СЕРВЕР.
 * Разбор 17.09 поймал ровно это: сервер уже знает «прочитано», а у чата
 * на экране горит «1». Проверка только сервера была бы зелёной на поломке,
 * которую видит человек.
 *
 * ⚠️ РЕПЛИКИ ВТОРОГО ЧЕЛОВЕКА ИДУТ ЗАПРОСАМИ, А НЕ НАБОРОМ. Сценарии
 * проверяют, что делает вкладка, получившая реплики, а не поле ввода:
 * набор по знаку растянул бы пачку на секунды и сделал бы окна в 3 с
 * гонкой.
 */

/** Запрос от имени человека этой вкладки — её же печенькой. */
async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const init: RequestInit = { method, credentials: "include" };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(path, init);
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
      return response.status === 204 ? undefined : response.json();
    },
    { method, path, body },
  ) as Promise<T>;
}

interface Row {
  id: string;
  title: string;
  unread: number;
}

async function rowOf(page: Page, title: string): Promise<Row> {
  const { items } = await call<{ items: Row[] }>(page, "GET", "/v1/conversations");
  const row = items.find((one) => one.title === title);
  if (!row) throw new Error(`нет чата «${title}»`);
  return row;
}

async function post(page: Page, conversationId: string, text: string): Promise<{ id: string }> {
  return call(page, "POST", `/v1/conversations/${conversationId}/messages`, {
    body: text,
    clientMsgId: crypto.randomUUID(),
  });
}

/** Строка чата в панели — по началу имени: в имя входит число непрочитанного. */
function channelRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Второй человек в том же пространстве. */
async function guestOf(browser: Browser, owner: Page): Promise<Page> {
  const guest = await browser.newPage();
  await invited(guest, owner, "Собеседник");
  return guest;
}

/** Номер последней реплики чата — по записи сервера. */
async function lastSeqOf(page: Page, conversationId: string): Promise<number> {
  const { items } = await call<{ items: { seq: number }[] }>(
    page,
    "GET",
    `/v1/conversations/${conversationId}/messages`,
  );
  const last = items.at(-1)?.seq;
  if (last === undefined) throw new Error("в чате нет реплик — сценарий доказывает не то");
  return last;
}

/**
 * Ответ на отметку «прочитано» этого чата. Не дождались за 15 с — отметка
 * потерялась: это и есть поломка, которую ловят сценарии ниже.
 */
function markLanded(page: Page, conversationId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/v1/conversations/${conversationId}/read`),
    { timeout: 15_000 },
  );
}

test("пачка реплик в смотримом чате — не пачка отметок «прочитано»", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await register(page);
  await createChannel(page, "Живой");
  await openChannel(page, "Общий");

  const guest = await guestOf(browser, page);
  const live = await rowOf(guest, "Живой");
  await post(guest, live.id, "до открытия");
  await expect(channelRow(page, "Живой")).toContainText("непрочитанных: 1");

  /**
   * ⚠️ ПЕРЕЧИТЫВАНИЕ ПАНЕЛИ ОТКЛОНЯЕТСЯ, И ЭТО НЕ ПОДГОНКА. Старое число
   * в строке открытого чата держится и в жизни — пока нет разрыва, панель
   * не перечитывается. Здесь его держит перехват, иначе сценарий зависел бы
   * от гонки «перечитывание при переходе против первой отметки».
   */
  await page.route("**/v1/panel*", (route) => route.abort());

  // Все отметки — с номером и временем ухода; первая — от открытия чата.
  const marks: { seq: number; at: number }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/read")) {
      marks.push({ seq: Number((request.postDataJSON() as { seq: number }).seq), at: Date.now() });
    }
  });
  const firstMark = page.waitForResponse(
    (response) => response.url().endsWith("/read") && response.request().method() === "POST",
  );
  await openChannel(page, "Живой");
  await firstMark;
  const opened = marks.length;

  await guest.evaluate(
    async ({ id }) => {
      await Promise.all(
        Array.from({ length: 8 }, (_, n) =>
          fetch(`/v1/conversations/${id}/messages`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: `пачка ${n + 1}`, clientMsgId: crypto.randomUUID() }),
          }),
        ),
      );
    },
    { id: live.id },
  );
  await expect(page.locator("article").filter({ hasText: /^пачка/ })).toHaveCount(8);

  // ⚠️ СЧИТАЕМ ПОСЛЕ ПРИЗНАКА, А НЕ ПОСЛЕ СНА: ушла отметка на последнюю
  // реплику пачки — значит, всё, что вкладка хотела сказать о пачке, сказано.
  const last = await lastSeqOf(guest, live.id);
  await expect
    .poll(() => Math.max(0, ...marks.map((one) => one.seq)), {
      timeout: 10_000,
      message: "отметка на последнюю реплику пачки не ушла",
    })
    .toBe(last);

  const batch = marks.slice(opened);
  // Одна отметка на пачку — прежний порог. Чистка task-125 предлагала «не больше
  // двух» (пачка на краю окна), но без наблюдённого случая: ожидание меняется только
  // с доказательством, что неправ тест. Покраснеет на краю окна — это и будет оно.
  expect(batch.length, "на каждую реплику уходит своя отметка «прочитано»").toBeLessThanOrEqual(1);
  for (let at = opened; at < marks.length; at += 1) {
    const gap = (marks[at]?.at ?? 0) - (marks[at - 1]?.at ?? 0);
    // Окно — 3000 мс (Р-029) литералом; 300 мс — допуск на таймеры браузера.
    expect(gap, "отметки чаще раза в 3 с").toBeGreaterThanOrEqual(3000 - 300);
  }
  await guest.close();
});

test("число прочитанного чата не загорается снова после перехода", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await register(page);
  await createChannel(page, "Первый");
  await createChannel(page, "Второй");

  const guest = await guestOf(browser, page);
  const first = await rowOf(guest, "Первый");
  const second = await rowOf(guest, "Второй");
  await post(guest, second.id, "ждёт во втором");

  await openChannel(page, "Первый");
  // Реплик в «Первом» до этой не было: первый ответ на отметку «Первого» —
  // ответ на отметку именно её, когда бы она ни ушла.
  const firstRead = markLanded(page, first.id);
  await post(guest, first.id, "увидел в первом");
  await expect(bubble(page, "увидел в первом")).toBeVisible();

  // Меньше чем через три секунды — пока отметка «Первого» ещё ждёт окна.
  await openChannel(page, "Второй");
  // Признак вместо сна: сервер подтвердил отметку — дальше число строки
  // ставит его ответ, и загореться снова ему не из чего.
  await firstRead;

  await expect(
    channelRow(page, "Первый"),
    "у прочитанного чата на экране снова горит число",
  ).not.toContainText("непрочитанных:");
  expect((await rowOf(page, "Первый")).unread, "отметка прочитанного чата потерялась").toBe(0);
  await guest.close();
});

test("после отказа догона пачка реплик не торопит повтор", async ({ page, browser }) => {
  test.setTimeout(60_000);
  // Разброс в самом верху окна: паузы повтора — известные 1, 2 и 4 секунды.
  await page.addInitScript(() => {
    Math.random = () => 0.999;
  });
  await register(page);
  await createChannel(page, "Сбой");

  const guest = await guestOf(browser, page);
  const room = await rowOf(guest, "Сбой");
  const original = await post(guest, room.id, "исходная");
  await openChannel(page, "Сбой");
  await expect(bubble(page, "исходная")).toBeVisible();

  const syncs: number[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/sync")) syncs.push(Date.now());
  });
  await page.route("**/v1/sync*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"сбой"}' }),
  );

  // Правка приезжает без посылки — вкладка идёт в догон и получает отказ.
  // Ждём третьего отказа: после него пауза повтора — 4 секунды, и пачка
  // укладывается в неё с запасом даже на нагруженном стенде (в долгом
  // прогоне пауза в 2 с перекрывалась пачкой — мигание сценария, не кода).
  await call(guest, "PATCH", `/v1/messages/${original.id}`, { body: "исходная, поправлена" });
  await expect.poll(() => syncs.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

  const before = syncs.length;
  // Реплики — по одной, каждая дожидается записи: звонки приходят
  // порознь, без прежней паузы в 80 мс между ними.
  for (let n = 1; n <= 8; n++) {
    await post(guest, room.id, `в сбое ${n}`);
  }

  expect(
    syncs.length - before,
    "каждая реплика после отказа отменяет паузу и шлёт догон сразу",
  ).toBe(0);

  // Положительный контроль: вкладка жива и повторяет — но выждав паузу.
  // Пауза после третьего отказа — 4 с (разброс прижат к верху окна);
  // 500 мс — допуск на время прихода запроса, меряем снаружи.
  await expect.poll(() => syncs.length, { timeout: 15_000 }).toBeGreaterThan(before);
  const pause = (syncs[before] ?? 0) - (syncs[before - 1] ?? 0);
  expect(pause, "повтор догона не выждал паузу").toBeGreaterThanOrEqual(4000 - 500);
  await guest.close();
});

test("уход в настройки не теряет отметку «прочитано»", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await register(page);
  await createChannel(page, "Перед уходом");

  const guest = await guestOf(browser, page);
  const room = await rowOf(guest, "Перед уходом");
  await openChannel(page, "Перед уходом");
  // Реплика в чате одна: первый ответ на отметку чата — ответ на отметку её.
  const landed = markLanded(page, room.id);
  await post(guest, room.id, "последнее перед уходом");
  await expect(bubble(page, "последнее перед уходом")).toBeVisible();

  await page.getByLabel("Профиль и настройки").click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  await expect(page).toHaveURL(/\/settings/);
  // Признак вместо сна в 4 с: отметка дошла до сервера и он ответил.
  await landed;

  expect((await rowOf(page, "Перед уходом")).unread, "отметка ушла вместе с экраном чата").toBe(0);
  await guest.close();
});
