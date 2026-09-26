import { bubble, openChannel, register, say } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * П-1 и П-2 из task-017: владелец зовёт, коллега входит, оба в одном чате.
 *
 * ⚠️ ЭТО ПЕРВЫЙ СЦЕНАРИЙ, В КОТОРОМ ЛЮДЕЙ ДВОЕ. Все прежние проверки
 * работали с одним человеком в двух вкладках — потому что второго завести
 * было НЕОТКУДА. Ровно эту дыру задача и закрывает, и проверять её надо
 * тем, чего раньше не существовало: настоящей парой.
 */

test("владелец зовёт по ссылке, коллега входит и оба говорят в одном канале", async ({
  page,
  browser,
}) => {
  await register(page, "Владелец");
  await say(page, "первое слово хозяина");

  // Ссылка выдаётся при открытии окна: в базе живёт только хеш, поэтому
  // показать её второй раз нельзя ни нам, ни кому-либо ещё.
  await page.getByLabel("Профиль и настройки").click();
  await page.getByRole("menuitem", { name: "Пригласить в пространство" }).click();

  const linkField = page.getByLabel("Ссылка-приглашение");
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  expect(link, "в ссылке нет пути входа").toContain("/join/");

  // Коллега — ДРУГОЙ браузерный контекст: своя печенька, своё хранилище.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(link);

  await guestPage.getByLabel("Почта").fill(`guest-${Date.now()}@example.test`);
  await guestPage.getByLabel("Пароль").fill("очень-длинный-пароль-для-теста");
  await guestPage.getByLabel("Как вас зовут").fill("Приглашённый");
  await guestPage.getByRole("button", { name: "Войти" }).click();

  // ⚠️ ТОКЕН УБРАН ИЗ АДРЕСА, И ПРОВЕРЯТЬ ЭТО НАДО ЗДЕСЬ — до того, как
  // мы куда-либо перешли. Сначала проверка стояла в конце, после открытия
  // канала: адрес к тому мигу менялся сам собой, и утверждение оставалось
  // зелёным даже со снятой очисткой. Поймано обратной проверкой, а не
  // чтением — из кода это не видно.
  await expect
    .poll(() => new URL(guestPage.url()).pathname, { timeout: 5_000 })
    .not.toContain("/join/");

  // Попал в ТУ ЖЕ компанию: видит канал и уже сказанное в нём.
  await openChannel(guestPage, "Общий");
  await expect(
    bubble(guestPage, "первое слово хозяина"),
    "вошедший не видит переписки — значит попал не в ту компанию",
  ).toBeVisible();

  // И обратно: сказанное гостем видно хозяину.
  await say(guestPage, "здравствуйте, я по ссылке");
  await expect(bubble(page, "здравствуйте, я по ссылке")).toBeVisible();

  await guestContext.close();
});
