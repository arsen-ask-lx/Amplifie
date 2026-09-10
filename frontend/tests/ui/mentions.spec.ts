import { expect, type Page, test } from "@playwright/test";
import {
  bubble,
  bubbles,
  createChannel,
  field,
  invited,
  openChannel,
  register,
  шрифтыГотовы,
} from "./fixtures.js";

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

/**
 * Набить ленту репликами, чтобы она перестала помещаться на экране.
 *
 * ⚠️ ЗАПРОСОМ, А НЕ ЧЕРЕЗ ПОЛЕ ВВОДА, И ЭТО ЕДИНСТВЕННОЕ ИСКЛЮЧЕНИЕ
 * ИЗ ПРАВИЛА «ВСЁ ЧЕРЕЗ ЭКРАН». Через поле пятнадцать реплик набираются
 * десять секунд, и сценарий начал мигать: в одиночку укладывался,
 * в общем прогоне — нет. Мигающий тест хуже отсутствующего.
 *
 * Правило при этом не нарушено по существу: проверяем мы не отправку —
 * её стерегут другие сценарии, — а переход к зову. Это просто фон,
 * и набирать его руками незачем.
 */
async function наговорить(page: Page, сколько: number): Promise<void> {
  await page.evaluate(async (n) => {
    const список = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const свежий = список.items[0].id;
    for (let i = 0; i < n; i++) {
      await fetch(`/v1/conversations/${свежий}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: `обычная реплика номер ${i}`,
          clientMsgId: crypto.randomUUID(),
        }),
      });
    }
  }, сколько);
  await expect(page.getByText(`обычная реплика номер ${сколько - 1}`)).toBeVisible();
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

test("Enter выбирает из подсказки, а не отправляет сообщение", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Выбор");

  const другой = await browser.newPage();
  await invited(другой, page, "Мария Петрова");
  await openChannel(page, "Выбор");

  /**
   * ⚠️ ЗАМЕЧАНИЕ ВЛАДЕЛЬЦА, И ОНО ПРО ПОРЯДОК ОБРАБОТЧИКОВ, А НЕ ПРО ВИД.
   * «Нажал собачку, стрелками выбрал нужного, нажал Enter — и сообщение
   * отправилось». Пока подсказка открыта, Enter принадлежит ЕЙ: человек
   * выбирает человека, а не заканчивает мысль. Отправляет уже следующий
   * Enter.
   */
  await field(page).click();
  await field(page).pressSequentially("@", { delay: 15 });
  await expect(page.getByRole("listbox", { name: "Кого позвать" })).toBeVisible();

  /**
   * ⚠️ ЖДЁМ НЕ СПИСОК, А СТРОКУ В НЁМ. Enter забирает себе подсказка —
   * но только если ей есть что выбрать. Список появляется раньше, чем
   * приезжает ответ «кого можно позвать»: между этими мгновениями Enter
   * достаётся полю ввода, и сообщение уходит. Под нагрузкой промежуток
   * растягивается, и сценарий мигал именно здесь.
   */
  await expect(
    page.getByRole("listbox", { name: "Кого позвать" }).getByRole("option").first(),
  ).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(
    bubbles(page),
    "первый Enter отправил сообщение, хотя человек всего лишь выбирал, кого позвать",
  ).toHaveCount(0);
  await expect(field(page), "выбранный человек не встал в поле").toContainText("Мария");

  // А вот теперь Enter отправляет — как и всегда.
  await field(page).pressSequentially(" глянь смету", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(bubble(page, "глянь смету")).toBeVisible();
});

test("Escape закрывает подсказку, но не выбивает из поля", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Отказ");

  const другой = await browser.newPage();
  await invited(другой, page, "Мария Петрова");
  await openChannel(page, "Отказ");

  /**
   * ⚠️ ПОЙМАНО ЖИВЫМ ОБХОДОМ, А НЕ ПРИДУМАНО. В ленте оказалась реплика
   * «, а это просто текст@Пётр Ильин» — хвост встал ПЕРЕД набранным.
   * Разбор показал: Escape выбивает фокус из поля вовсе (браузер уводит
   * его на страницу), и всё, что человек печатает дальше, уходит в никуда.
   * Подсказки для этого даже не нужно — но именно в ней Escape нажимают
   * чаще всего: «список не нужен, пишу дальше».
   */
  await field(page).click();
  await page.keyboard.type("@Мария", { delay: 20 });
  await expect(page.getByRole("listbox", { name: "Кого позвать" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Кого позвать" }),
    "Escape не закрыл подсказку",
  ).toHaveCount(0);

  await page.keyboard.type(" и Пётр", { delay: 20 });
  await expect(field(page), "после Escape при открытой подсказке поле потеряло фокус").toHaveText(
    "@Мария и Пётр",
  );

  /**
   * ⚠️ ВТОРОЙ ESCAPE — ГЛАВНЫЙ, И ИМЕННО ОН ЛОМАЛСЯ. Пока подсказка
   * открыта, Escape забирает себе она и фокус цел. Стоит списку
   * закрыться — и клавишу получает браузер, а он уводит фокус
   * из редактируемой области на страницу. Человек этого не видит:
   * поле выглядит прежним, курсор в нём не мигает, буквы пропадают.
   */
  await page.keyboard.press("Escape");
  await page.keyboard.type(" тоже", { delay: 20 });
  await expect(
    field(page),
    "Escape при закрытой подсказке выбил из поля: набранное уходит в никуда",
  ).toHaveText("@Мария и Пётр тоже");
});

test("подсказка не растягивает страницу и не двигает интерфейс", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Ширина");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await openChannel(page, "Ширина");

  /**
   * ⚠️ МЕРЯЕМ СТРАНИЦУ, А НЕ СПИСОК. Замечание владельца звучало так:
   * «нажимаю собачку — появляется боковой скрол и сдвигает нам всё».
   * Причина была не в виде списка, а в том, что плагин ставил свой узел
   * в КОНЕЦ СТРАНИЦЫ и двигал его к каретке; страница от этого росла.
   * Свойство, которое надо стеречь, — «страница не выросла», и увидеть
   * его можно только по самой странице.
   */
  const ширина = () =>
    page.evaluate(() => ({
      прокрутка: document.documentElement.scrollWidth,
      окно: document.documentElement.clientWidth,
      высота: document.documentElement.scrollHeight,
      экран: document.documentElement.clientHeight,
    }));

  // Ширину страницы меряем после доезда шрифта: пока он едет, вёрстка
  // считается по запасному, и числа «до» и «после» окажутся про разное.
  await шрифтыГотовы(page);
  const до = await ширина();
  expect(до.прокрутка, "страница уже шире окна до всякой подсказки").toBeLessThanOrEqual(до.окно);

  await field(page).click();
  await field(page).pressSequentially("@", { delay: 15 });
  await expect(page.getByRole("listbox", { name: "Кого позвать" })).toBeVisible();

  const после = await ширина();
  expect(после.прокрутка, "подсказка растянула страницу вбок — вернулась боковая полоса").toBe(
    до.прокрутка,
  );
  expect(после.высота, "подсказка растянула страницу вниз").toBe(до.высота);
  expect(после.прокрутка).toBeLessThanOrEqual(после.окно);
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
  await наговорить(page, 15);

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
