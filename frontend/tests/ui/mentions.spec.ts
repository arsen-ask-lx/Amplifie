import { expect, type Page, test } from "@playwright/test";
import { bubble, createChannel, field, invited, openChannel, register, say } from "./fixtures.js";

/**
 * СЦЕНАРИИ УПОМИНАНИЯ (Р-031, task-033).
 *
 * Проверяют то, что доказать иначе нельзя:
 *   ① подсказка вообще открывается и ставит УПОМИНАНИЕ, а не текст.
 *      Приёмочная по протоколу этого не видит: она сама собирает запись
 *      руками и о поле ввода не знает ничего;
 *   ② значок у канала виден ОТДЕЛЬНО от числа непрочитанного;
 *   ③ набранное руками имя упоминанием не становится — то самое, от чего
 *      ушли в Р-031, и в браузере это проверяется единственным способом:
 *      действительно набрать его руками.
 *
 * Бьёт по собранному образу. Перед запуском: make up
 */

/**
 * ⚠️ КАНАЛ ИЩЕТСЯ ПО НАЧАЛУ ИМЕНИ. Доступное имя кнопки обрастает
 * числами со словами: «Совещание упоминаний: 1 непрочитанных: 3».
 * Точное совпадение перестало бы находить ровно те каналы, ради которых
 * сценарий и написан.
 */
function канал(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Позвать через подсказку: набрать собачку и выбрать первого из списка. */
async function позвать(page: Page, кого: string): Promise<void> {
  await field(page).click();
  await field(page).pressSequentially("@", { delay: 15 });

  const список = page.getByRole("listbox", { name: "Кого позвать" });
  await expect(список, "подсказка не открылась на собачку").toBeVisible();

  const строка = список.getByRole("option", { name: кого });
  await expect(строка, `в подсказке нет «${кого}»`).toBeVisible();
  await строка.click();
}

test("подсказка ставит упоминание, и у позванного загорается свой значок", async ({
  page,
  browser,
}) => {
  await register(page, "Хозяин");
  await createChannel(page, "Совещание");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");

  // Позванный уходит из канала: иначе три условия отметки прочтения
  // выполнены, всё гаснет сразу и проверять становится нечего.
  await openChannel(другой, "Общий");
  await openChannel(page, "Совещание");

  await позвать(page, "Коллега");
  await field(page).pressSequentially("глянь, пожалуйста", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();

  // В ленте — имя человека, а не скобочная запись с номером.
  const реплика = bubble(page, "глянь, пожалуйста");
  await expect(реплика).toContainText("@Коллега");
  await expect(реплика, "в ленте видна внутренняя запись упоминания").not.toContainText("](@");

  /**
   * ⚠️ ПРОВЕРЯЕМ ДОСТУПНОЕ ИМЯ КНОПКИ, А НЕ КАРТИНКУ. Значок с собачкой
   * глазами не отличить от значка с числом; слово «упоминаний» —
   * единственное, что говорит, какое из двух чисел загорелось.
   */
  await expect(
    канал(другой, "Совещание"),
    "у позванного не загорелся отдельный значок упоминания",
  ).toHaveAccessibleName(/упоминаний:/u);
});

test("набранное руками имя упоминанием не становится", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Планёрка");

  const другой = await browser.newPage();
  await invited(другой, page, "Соседка");
  await openChannel(другой, "Общий");
  await openChannel(page, "Планёрка");

  // Набираем имя целиком и НЕ выбираем из списка: закрываем подсказку
  // Escape — ровно так делает тот, кто про неё не знает и просто пишет.
  await field(page).click();
  await field(page).pressSequentially("@Соседка", { delay: 15 });
  await page.keyboard.press("Escape");
  await field(page).pressSequentially(", глянь", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(bubble(page, "глянь").getByLabel("доставлено")).toBeVisible();

  const строка = канал(другой, "Планёрка");
  await expect(строка, "сообщение должно быть просто непрочитанным").toHaveAccessibleName(
    /непрочитанных:/u,
  );
  await expect(
    строка,
    "поиск имени по тексту вернулся: набранное руками посчиталось зовом",
  ).not.toHaveAccessibleName(/упоминаний:/u);
});

test("кнопка ведёт к самому раннему зову", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Стройка");

  const другой = await browser.newPage();
  await invited(другой, page, "Прораб");
  await openChannel(другой, "Общий");
  await openChannel(page, "Стройка");

  await позвать(page, "Прораб");
  await field(page).pressSequentially("первый зов", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(bubble(page, "первый зов").getByLabel("доставлено")).toBeVisible();

  /**
   * ⚠️ РЕПЛИК МНОГО НАРОЧНО: ЗОВ ОБЯЗАН УЕХАТЬ ЗА КРАЙ ЭКРАНА.
   *
   * Первая редакция ставила три реплики и проверяла, что зов «видим».
   * Обратная проверка её не свалила: с тремя репликами зов и так был
   * на экране, и тест оставался зелёным, даже когда переход никуда
   * не вёл. Настоящее свойство — «зов попал в ПОЛЕ ЗРЕНИЯ после нажатия,
   * а до него там не был», и проверяется оно только на ленте, которая
   * не помещается целиком.
   */
  for (let i = 0; i < 15; i++) await say(page, `обычная реплика номер ${i}`);

  /**
   * ⚠️ ВКЛАДКА ПОЗВАННОГО — В ФОНЕ, И БЕЗ ЭТОГО ПРОВЕРЯТЬ БЫЛО БЫ НЕЧЕГО.
   * Стоит ему открыть канал на виду, внизу ленты и в фокусе — выполнены
   * все три условия отметки (Р-029), зов мгновенно считается увиденным,
   * и кнопка перехода исчезает раньше, чем на неё можно нажать. Подмена
   * `visibilityState` — тот же приём, что в проверке непрочитанного,
   * и она проверяет ровно то свойство, на которое смотрит код.
   */
  await другой.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await openChannel(другой, "Стройка");

  const зов = bubble(другой, "первый зов");
  await expect(
    зов,
    "лента открылась не в конце — проверять переход не на чем",
  ).not.toBeInViewport();

  const кнопка = другой.getByRole("button", { name: /Перейти к упоминанию/u });
  await expect(кнопка, "кнопки перехода к упоминанию нет").toBeVisible();
  await кнопка.click();

  await expect(зов, "переход не привёл к зову").toBeInViewport();
});
