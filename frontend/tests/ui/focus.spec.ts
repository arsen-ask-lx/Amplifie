import { expect, test } from "@playwright/test";
import {
  bubble,
  createChannel,
  field,
  inviteToken,
  joinVoice,
  menu,
  openChannel,
  register,
} from "./fixtures.js";

/**
 * ОТКРЫЛ ЧАТ — СРАЗУ ПЕЧАТАЕШЬ (владелец 26.09).
 *
 * «Включил чат, начал печатать — текст сразу появляется в поле. А сейчас
 * нужно ткнуть в строку ввода и только потом печатать — жутко неудобно».
 * И второе: «Ответить» из меню в первый раз курсор в поле не ставило.
 *
 * ⚠️ ПЕЧАТАЕМ КЛАВИАТУРОЙ СТРАНИЦЫ, А НЕ В ПОЛЕ. `field.fill` или щелчок
 * по полю сами ставят в него фокус — и проверка прошла бы на сломанном коде.
 * Человек не щёлкает: он открыл чат и сразу стучит по клавишам.
 */

test("открыл чат щелчком в панели — печатаешь сразу, без щелчка по полю", async ({ page }) => {
  await register(page, "Печатающий");
  await createChannel(page, "Смета");
  await createChannel(page, "Договор");

  await openChannel(page, "Смета");
  await page.keyboard.type("сразу в смету", { delay: 15 });
  await expect(field(page)).toHaveText("сразу в смету");

  // Ушёл читать ленту и щёлкнул по тому же, уже открытому чату — курсор
  // снова в поле: адрес не меняется, но человек «включил чат».
  // Пустой чат: ленты нет, фокус уводим щелчком по заголовку.
  await page.getByRole("heading", { name: "Смета", level: 2 }).click();
  await expect(field(page)).not.toBeFocused();
  await page.getByRole("button", { name: /^Смета/u }).click();
  await page.keyboard.type(" и ещё", { delay: 15 });
  await expect(field(page)).toHaveText("сразу в смету и ещё");
});

test("завёл новый чат — печатаешь сразу", async ({ page }) => {
  await register(page, "Заводящий");
  // Как человек: окно, название, Enter — и сразу стучит по клавишам.
  // Без `createChannel`: та следом щёлкает по строке чата, а человек нет.
  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await page.getByLabel("Название нового чата").fill("Свежий");
  await page.getByLabel("Название нового чата").press("Enter");
  await expect(page.getByRole("heading", { name: "Свежий", level: 2 })).toBeVisible();
  await page.keyboard.type("первое слово", { delay: 15 });
  await expect(field(page)).toHaveText("первое слово");
});

test("«Ответить» на свежую чужую реплику ставит курсор в поле с первого раза", async ({
  page,
  playwright,
}) => {
  await register(page, "Отвечающий");
  await createChannel(page, "Разговор");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");

  // Три раза подряд, и каждый раз на ТОЛЬКО ЧТО ПРИШЕДШУЮ реплику:
  // владелец поймал провал ровно на первом нажатии по новому сообщению.
  for (const n of [1, 2, 3]) {
    const text = `вопрос номер ${n}`;
    const said = await guest.post(`/v1/conversations/${room}/messages`, {
      data: { body: text, clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok()).toBe(true);
    await expect(bubble(page, text)).toBeVisible();

    // Уводим фокус из поля — как если бы человек только что читал ленту.
    await page.getByRole("log").click({ position: { x: 5, y: 5 } });
    await menu(page, text, "Ответить");
    await page.keyboard.type(`ответ ${n}`, { delay: 15 });
    await expect(field(page), `ответ ${n} не попал в поле`).toHaveText(`ответ ${n}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
  }
  await guest.dispose();
});
