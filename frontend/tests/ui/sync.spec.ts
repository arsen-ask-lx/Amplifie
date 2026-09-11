import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  bubble,
  createChannel,
  login,
  menu,
  openChannel,
  register,
  removeMessage,
  saveEdit,
  say,
} from "./fixtures.js";

/**
 * П-2, П-3, П-4: правка, удаление и закрепление доезжают до второй вкладки.
 *
 * ⚠️ ЭТО ПРОВЕРКА Р-021 СО СТОРОНЫ ЧЕЛОВЕКА. Со стороны сервера она уже
 * есть: приёмочные бека доказывают, что `/v1/sync` отдаёт правильные
 * строки и надгробия. Что клиент их правильно ПРИМЕНЯЕТ, не проверено
 * ничем — а именно там и жили поломки.
 *
 * ⚠️ ДВА КОНТЕКСТА, А НЕ ДВЕ СТРАНИЦЫ ОДНОГО. У каждого своя печенька
 * и своё хранилище: это настоящие две вкладки, а не одна с двумя видами.
 * Заодно стережёт, что вкладки не делят состояние через что-то, чего мы
 * не заметили. Ровно этого Cypress и не умеет — см. Р-022.
 */

/** Второй вход тем же человеком: открыть канал и дождаться реплики. */
async function secondTab(
  browser: Browser,
  person: Parameters<typeof login>[1],
  channel: string,
  wait: string,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, person);
  await openChannel(page, channel);
  await expect(bubble(page, wait)).toBeVisible();
  return page;
}

test("П-2: правка в одной вкладке доезжает до второй", async ({ page, browser }) => {
  const person = await register(page);
  await createChannel(page, "Смета");
  await say(page, "смета на сто рублей");

  const secondPage = await secondTab(browser, person, "Смета", "смета на сто рублей");

  await menu(page, "смета на сто рублей", "Изменить");
  await saveEdit(page, "смета на двести рублей");

  await expect(
    bubble(secondPage, "смета на двести рублей"),
    "правка не доехала до второй вкладки — догон не отдал изменённую реплику или клиент её не применил",
  ).toBeVisible();
  await expect(bubble(secondPage, "смета на сто рублей")).toHaveCount(0);

  await secondPage.context().close();
});

/** Сказать реплику, ответить на неё и открыть вторую вкладку. */
async function saidAndAnswered(page: Page, browser: Browser) {
  const person = await register(page);
  await createChannel(page, "Смета");
  await say(page, "подрядчик подтвердил срок");
  await menu(page, "подрядчик подтвердил срок", "Ответить");
  await say(page, "тогда закладываем в план");
  return secondTab(browser, person, "Смета", "тогда закладываем в план");
}

test("П-3: удалённая реплика уходит из второй вкладки", async ({ page, browser }) => {
  const secondPage = await saidAndAnswered(page, browser);

  await removeMessage(page, "подрядчик подтвердил срок");

  await expect(
    bubble(secondPage, "подрядчик подтвердил срок").filter({ hasNotText: "тогда закладываем" }),
    "удалённая реплика осталась во второй вкладке — надгробие не доехало",
  ).toHaveCount(0);
  await expect(bubble(secondPage, "тогда закладываем в план")).toBeVisible();

  await secondPage.context().close();
});

/**
 * П-3б: цитата на удалённую реплику уходит и из ОТКРЫТОЙ вкладки.
 *
 * ⚠️ ЭТОТ ТЕСТ ДЕНЬ ПРОЖИЛ ОЖИДАЕМО КРАСНЫМ (Д-20). Он нашёл настоящую
 * поломку: удаление двигало номер изменения только у самой реплики,
 * а у ответов на неё — нет, и цитата из удалённого оставалась на экране
 * у всех, кто держал вкладку открытой. Перезагрузка её убирала — потому
 * поломку и не воспроизводили.
 *
 * Пометка `test.fail` снята не по решению, а по требованию прогона:
 * после починки он покраснел как «прошёл, хотя не должен был».
 */
test("П-3б: цитата на удалённую реплику уходит из открытой вкладки", async ({ page, browser }) => {
  const secondPage = await saidAndAnswered(page, browser);
  await expect(
    bubble(secondPage, "тогда закладываем в план").getByTitle("Перейти к сообщению"),
  ).toBeVisible();

  await removeMessage(page, "подрядчик подтвердил срок");

  await expect(
    bubble(secondPage, "тогда закладываем в план").getByTitle("Перейти к сообщению"),
    "цитата на удалённую реплику осталась на экране",
  ).toHaveCount(0);

  await secondPage.context().close();
});

test("П-4: закрепление доезжает до второй вкладки", async ({ page, browser }) => {
  const person = await register(page);
  await createChannel(page, "Смета");
  await say(page, "встреча переносится на четверг");

  const secondPage = await secondTab(browser, person, "Смета", "встреча переносится на четверг");
  await expect(secondPage.getByText("Закреплённое сообщение")).toHaveCount(0);

  await menu(page, "встреча переносится на четверг", "Закрепить");

  await expect(
    secondPage.getByText("Закреплённое сообщение"),
    "полоска закреплённого не появилась во второй вкладке",
  ).toBeVisible();
  await expect(secondPage.getByTitle("Перейти к закреплённому")).toContainText(
    "встреча переносится на четверг",
  );

  await secondPage.context().close();
});
