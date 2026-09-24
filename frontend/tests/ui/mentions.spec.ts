import { expect, type Page, test } from "@playwright/test";
import {
  bubble,
  bubbles,
  createChannel,
  field,
  fontsReady,
  invited,
  openChannel,
  register,
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
function channelRow(page: Page, title: string) {
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
async function sayMany(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const list = await fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json());
    const freshId = list.items[0].id;
    for (let i = 0; i < n; i++) {
      await fetch(`/v1/conversations/${freshId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: `обычная реплика номер ${i}`,
          clientMsgId: crypto.randomUUID(),
        }),
      });
    }
  }, count);
  await expect(page.getByText(`обычная реплика номер ${count - 1}`)).toBeVisible();
}

/** Позвать через подсказку: набрать собачку и выбрать первого из списка. */
async function mentionPerson(page: Page, who: string): Promise<void> {
  await field(page).click();
  await field(page).pressSequentially("@", { delay: 15 });

  const list = page.getByRole("listbox", { name: "Кого позвать" });
  await expect(list, "подсказка не открылась на собачку").toBeVisible();

  const option = list.getByRole("option", { name: who });
  await expect(option, `в подсказке нет «${who}»`).toBeVisible();
  await option.click();
}

test("подсказка ставит упоминание, и у позванного загорается свой значок", async ({
  page,
  browser,
}) => {
  await register(page, "Хозяин");
  await createChannel(page, "Совещание");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Коллега");

  // Позванный уходит из канала: иначе три условия отметки прочтения
  // выполнены, всё гаснет сразу и проверять становится нечего.
  await openChannel(otherPage, "Общий");
  await openChannel(page, "Совещание");

  await mentionPerson(page, "Коллега");
  await field(page).pressSequentially("глянь, пожалуйста", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();

  // В ленте — имя человека, а не скобочная запись с номером.
  const message = bubble(page, "глянь, пожалуйста");
  await expect(message).toContainText("@Коллега");
  await expect(message, "в ленте видна внутренняя запись упоминания").not.toContainText("](@");

  /**
   * ⚠️ ПРОВЕРЯЕМ ДОСТУПНОЕ ИМЯ КНОПКИ, А НЕ КАРТИНКУ. Значок с собачкой
   * глазами не отличить от значка с числом; слово «упоминаний» —
   * единственное, что говорит, какое из двух чисел загорелось.
   */
  await expect(
    channelRow(otherPage, "Совещание"),
    "у позванного не загорелся отдельный значок упоминания",
  ).toHaveAccessibleName(/упоминаний:/u);
});

test("Enter выбирает из подсказки, а не отправляет сообщение", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Выбор");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Мария Петрова");
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

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Мария Петрова");
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

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Коллега");
  await openChannel(page, "Ширина");

  /**
   * ⚠️ МЕРЯЕМ СТРАНИЦУ, А НЕ СПИСОК. Замечание владельца звучало так:
   * «нажимаю собачку — появляется боковой скрол и сдвигает нам всё».
   * Причина была не в виде списка, а в том, что плагин ставил свой узел
   * в КОНЕЦ СТРАНИЦЫ и двигал его к каретке; страница от этого росла.
   * Свойство, которое надо стеречь, — «страница не выросла», и увидеть
   * его можно только по самой странице.
   */
  const sizes = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));

  // Ширину страницы меряем после доезда шрифта: пока он едет, вёрстка
  // считается по запасному, и числа «до» и «после» окажутся про разное.
  await fontsReady(page);
  const before = await sizes();
  expect(before.scrollWidth, "страница уже шире окна до всякой подсказки").toBeLessThanOrEqual(
    before.clientWidth,
  );

  await field(page).click();
  await field(page).pressSequentially("@", { delay: 15 });
  await expect(page.getByRole("listbox", { name: "Кого позвать" })).toBeVisible();

  const after = await sizes();
  expect(after.scrollWidth, "подсказка растянула страницу вбок — вернулась боковая полоса").toBe(
    before.scrollWidth,
  );
  expect(after.scrollHeight, "подсказка растянула страницу вниз").toBe(before.scrollHeight);
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth);
});

test("набранное руками имя упоминанием не становится", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Планёрка");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Соседка");
  await openChannel(otherPage, "Общий");
  await openChannel(page, "Планёрка");

  // Набираем имя целиком и НЕ выбираем из списка: закрываем подсказку
  // Escape — ровно так делает тот, кто про неё не знает и просто пишет.
  await field(page).click();
  await field(page).pressSequentially("@Соседка", { delay: 15 });
  await page.keyboard.press("Escape");
  await field(page).pressSequentially(", глянь", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(bubble(page, "глянь").getByLabel("доставлено")).toBeVisible();

  const option = channelRow(otherPage, "Планёрка");
  await expect(option, "сообщение должно быть просто непрочитанным").toHaveAccessibleName(
    /непрочитанных:/u,
  );
  await expect(
    option,
    "поиск имени по тексту вернулся: набранное руками посчиталось зовом",
  ).not.toHaveAccessibleName(/упоминаний:/u);
});

test("кнопка ведёт к самому раннему зову", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Стройка");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Прораб");
  await openChannel(otherPage, "Общий");
  await openChannel(page, "Стройка");

  /**
   * ⚠️ РЕПЛИК МНОГО НАРОЧНО: ЗОВ ОБЯЗАН УЕХАТЬ ЗА КРАЙ ЭКРАНА.
   *
   * Первая редакция ставила три реплики и проверяла, что зов «видим».
   * Обратная проверка её не свалила: с тремя репликами зов и так был
   * на экране, и тест оставался зелёным, даже когда переход никуда
   * не вёл. Настоящее свойство — «зов попал в ПОЛЕ ЗРЕНИЯ после нажатия,
   * а до него там не был», и проверяется оно только на ленте, которая
   * не помещается целиком.
   *
   * ⚠️ ОБЫЧНЫЕ РЕПЛИКИ ИДУТ ПЕРЕД ЗОВОМ, А НЕ ПОСЛЕ (Д-56). Прежде зов
   * говорился первым — и тогда он же был первым непрочитанным, а чат
   * с непрочитанным открывается НА ЧЕРТЕ (talk/history). То есть зов
   * оказывался прямо под чертой, на виду, и проверять переход было
   * не на чем. Сценарий зеленел только в те прогоны, где лента
   * на черту не встала, — то есть держался за поломку. Теперь
   * непрочитанное начинается с обычных реплик, черта встаёт на них,
   * а зов лежит ниже края экрана — как у человека, которого позвали
   * в конце долгого разговора.
   */
  await sayMany(page, 15);

  await mentionPerson(page, "Прораб");
  await field(page).pressSequentially("первый зов", { delay: 10 });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(bubble(page, "первый зов").getByLabel("доставлено")).toBeVisible();

  /**
   * ⚠️ ВКЛАДКА ПОЗВАННОГО — В ФОНЕ, И БЕЗ ЭТОГО ПРОВЕРЯТЬ БЫЛО БЫ НЕЧЕГО.
   * Стоит ему открыть канал на виду, внизу ленты и в фокусе — выполнены
   * все три условия отметки (Р-029), зов мгновенно считается увиденным,
   * и кнопка перехода исчезает раньше, чем на неё можно нажать. Подмена
   * `visibilityState` — тот же приём, что в проверке непрочитанного,
   * и она проверяет ровно то свойство, на которое смотрит код.
   */
  await otherPage.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await openChannel(otherPage, "Стройка");

  /**
   * ⚠️ СНАЧАЛА ВИДИМОЕ УСЛОВИЕ, ПОТОМ ОБРАТНОЕ (Д-56). «Зова не видно»
   * означает две разные вещи: «лента встала на черту, и зов ниже края» —
   * то, что мы хотим, — и «лента ещё не нарисована». На занятой машине
   * чаще второе, и сценарий краснел в пачке на исправном коде, оставаясь
   * зелёным в одиночку. Ждём первую непрочитанную в поле зрения: она и значит
   * «лента встала на черту», и только после этого обратная проверка
   * что-то говорит.
   */
  await expect(
    bubble(otherPage, "обычная реплика номер 0"),
    "лента не встала на черту",
  ).toBeInViewport();

  const mentionBubble = bubble(otherPage, "первый зов");
  await expect(
    mentionBubble,
    "зов виден с порога — проверять переход не на чем",
  ).not.toBeInViewport();

  const button = otherPage.getByRole("button", { name: /Перейти к упоминанию/u });
  await expect(button, "кнопки перехода к упоминанию нет").toBeVisible();
  await button.click();

  await expect(mentionBubble, "переход не привёл к зову").toBeInViewport();
});
