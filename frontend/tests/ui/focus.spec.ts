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
  say,
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

/**
 * КАК В TELEGRAM: ПЕЧАТАЕШЬ — БУКВЫ ИДУТ В ПОЛЕ, КУДА БЫ НИ ЩЁЛКНУЛ ДО ЭТОГО.
 *
 * Владелец 26.09: «нажал на закреплённое — и опять не могу сразу печатать,
 * курсор снова на поле ставить». Щелчок по закреплённому, по ленте, по
 * заголовку уводит фокус из поля, и набранное терялось. Telegram Desktop
 * отправляет печатный знак в поле, если фокус не в другом поле ввода.
 */
/**
 * Печать как с русской раскладки: настоящие нажатия клавиш.
 *
 * ⚠️ `keyboard.type` ДЛЯ КИРИЛЛИЦЫ НАЖАТИЙ НЕ ШЛЁТ — он вставляет текст
 * напрямую, мимо `keydown`, и `press("п")` отвечает «Unknown key». Живая
 * клавиатура на русской раскладке нажатия шлёт, и перенос букв в поле
 * держится ровно на них. Без этой эмуляции сценарий краснел на исправном
 * коде (проба 26.09: латиница проходила, кириллица — нет).
 */
async function typeRussian(page: import("@playwright/test").Page, text: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const ch of text) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: ch,
      text: ch,
      unmodifiedText: ch,
    });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
  await cdp.detach();
}

test("щёлкнул по закреплённому или по ленте — печатаешь сразу", async ({ page }) => {
  await register(page, "Щёлкающий");
  await createChannel(page, "Смета");
  await say(page, "срок 15 октября");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  const list = (await (await page.request.get(`/v1/conversations/${room}/messages`)).json()) as {
    items: Array<{ id: string; body: string }>;
  };
  const target = list.items.find((one) => one.body === "срок 15 октября");
  expect((await page.request.post(`/v1/messages/${target?.id}/pin`)).ok()).toBe(true);

  const bar = page.getByTitle("Перейти к закреплённому");
  await expect(bar).toBeVisible();
  await bar.click();
  // Как в Telegram: щелчок по закреплённому ведёт к реплике и возвращает
  // курсор в поле — на кнопке полоски он не остаётся (и рамки на ней нет).
  await expect(field(page)).toBeFocused();
  await typeRussian(page, "после закрепа");
  await expect(field(page)).toHaveText("после закрепа");

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.getByRole("log").click({ position: { x: 5, y: 5 } });
  await expect(field(page)).not.toBeFocused();
  await typeRussian(page, "после ленты");
  await expect(field(page)).toHaveText("после ленты");
});

test("в другом поле ввода буквы остаются там, а не уходят в сообщение", async ({ page }) => {
  await register(page, "Ищущий");
  await createChannel(page, "Смета");
  await page.getByRole("button", { name: "Поиск в этом чате" }).click();
  await typeRussian(page, "смета");
  await expect(field(page)).toHaveText("");
});
