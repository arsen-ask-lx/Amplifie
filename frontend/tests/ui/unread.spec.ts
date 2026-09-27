import {
  bubble,
  createChannel,
  feedBox,
  field,
  invited,
  openChannel,
  register,
  say,
  typeInto,
} from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * НЕПРОЧИТАННОЕ ГЛАЗАМИ ЧЕЛОВЕКА (task-024, Р-029).
 *
 * ⚠️ ЭТИ СЦЕНАРИИ ЗАКРЫВАЮТ ТО, ЧЕГО НЕ ВИДЯТ ПРИЁМОЧНЫЕ. Те доказывают,
 * что сервер считает верно и не откатывает номер назад. А человек
 * спрашивает другое: «вижу ли я, где меня ждут» и «не съело ли оно
 * непрочитанное, пока я смотрел в другое окно».
 *
 * Второй вопрос важнее первого. Отметка идёт ТОЛЬКО ВПЕРЁД, отменить её
 * нечем: вкладка, забытая открытой, не имеет права пометить прочитанным
 * то, чего человек не видел.
 */

/**
 * Строка канала в панели.
 *
 * ⚠️ ПО НАЧАЛУ ИМЕНИ, А НЕ ЦЕЛИКОМ, И ЭТО СЛЕДСТВИЕ САМОЙ ЗАДАЧИ.
 * У канала с непрочитанным доступное имя кнопки — «Совещание
 * непрочитанных: 2»: число снабжено словом для чтения с экрана, иначе
 * голая цифра вслух не значит ничего. Точное совпадение по названию
 * после этого не находит ровно те каналы, ради которых сценарий
 * и написан.
 */
function channelRow(page: import("@playwright/test").Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

test("непрочитанное видно числом у канала и чертой в ленте", async ({ page, browser }) => {
  await register(page);
  await createChannel(page, "Совещание");

  // Второй человек — в своей вкладке: непрочитанное без чужих реплик
  // не проверить вовсе, свои не считаются по построению.
  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Коллега");

  /**
   * ⚠️ ХОЗЯИН УХОДИТ ИЗ КАНАЛА ДО ТОГО, КАК ТАМ ЗАГОВОРЯТ, И ЭТО НЕ
   * УКРАШЕНИЕ СЦЕНАРИЯ. Первая редакция оставляла его в «Совещании»:
   * реплики приходили ему на глаза, лента стояла внизу, вкладка была
   * в фокусе — то есть выполнялись все три условия, и всё помечалось
   * прочитанным сразу. Счётчик честно показывал ноль, а я думал,
   * что сломан он.
   */
  await openChannel(page, "Общий");

  await openChannel(otherPage, "Совещание");
  await say(otherPage, "первое чужое");
  await say(otherPage, "второе чужое");

  const row = channelRow(page, "Совещание");
  // Слово для чтения с экрана лежит в самой строке — ищем по нему, а не
  // по голой цифре: «2» найдётся и в названии канала с двойкой.
  await expect(row).toContainText("непрочитанных: 2");

  // Возвращаемся — черта стоит перед первой непрочитанной.
  await openChannel(page, "Совещание");
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  /**
   * ⚠️ ЧЕРТА ЗАМИРАЕТ. Пришла третья реплика — черта обязана остаться
   * над ПЕРВОЙ непрочитанной, а не переехать под свежую. Убегающая вниз
   * черта всегда стоит под последним сообщением и не отвечает
   * на вопрос «докуда я дочитал».
   */
  await say(otherPage, "третье чужое");
  await expect(bubble(page, "третье чужое")).toBeVisible();
  await expect(page.getByText("Непрочитанные сообщения")).toBeVisible();

  // Число гаснет: разговор открыт, лента внизу, вкладка в фокусе.
  await expect(row).not.toContainText("непрочитанных:");
  await otherPage.close();
});

test("вкладка в фоне не помечает прочитанным ничего", async ({ page, browser }) => {
  // Часы подделаны, чтобы проверить тишину без сна: до прыжка идут как настоящие.
  await page.clock.install();
  await register(page);
  await createChannel(page, "Тихий");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Пишущий");
  await openChannel(otherPage, "Тихий");

  // Хозяин смотрит ровно в этот канал и стоит внизу ленты — то есть
  // выполнены ДВА условия из трёх.
  await openChannel(page, "Тихий");

  /**
   * ⚠️ ПОДМЕНЯЕМ ВИДИМОСТЬ, А НЕ СВОРАЧИВАЕМ ОКНО. Свернуть окно из теста
   * нельзя, а браузер и так считает страницу видимой. Подмена
   * `visibilityState` — единственный способ проверить третье условие,
   * и проверяет она ровно его: код смотрит на это же свойство.
   */
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const marks: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/read")) marks.push(request.url());
  });

  await say(otherPage, "пока тебя нет");
  await expect(bubble(page, "пока тебя нет")).toBeVisible();

  /**
   * ⚠️ ОКНО — ПРЫЖКОМ ЧАСОВ, А НЕ СНОМ В 4 С. Прыжок дальше окна отметок
   * (3 с, Р-029) срабатывает отложенная отметка, будь она. Запрос-метка
   * после прыжка — признак, что всё, начатое вкладкой до неё, уже посчитано:
   * запросы приходят по порядку.
   */
  await page.clock.fastForward(3_500);
  const probe = page.waitForRequest((request) => request.url().includes("probe=unread"));
  await page.evaluate(async () => {
    await fetch("/v1/me?probe=unread", { credentials: "include" });
  });
  await probe;
  expect(marks, "фоновая вкладка отправила отметку прочтения").toEqual([]);

  /**
   * ⚠️ СПРАШИВАЕМ СЕРВЕР, А НЕ СМОТРИМ НА ЗНАЧОК, И ЭТО ИСПРАВЛЕНИЕ САМОЙ
   * ПРОВЕРКИ. Сперва здесь стояло «у канала висит число» — и обратная
   * проверка её не свалила: сняв условие видимости, я получил тот же
   * зелёный. Причина в том, что значок собирается из ДВУХ источников —
   * ответа сервера и наших же отметок в памяти вкладки, — и на экране
   * они гасят друг друга.
   *
   * Настоящее свойство одно: фоновая вкладка НЕ СКАЗАЛА СЕРВЕРУ, что
   * прочитала. Его и спрашиваем — тем же запросом, каким живёт панель.
   */
  const serverCount = async () => {
    const list = (await page.evaluate(() =>
      fetch("/v1/conversations", { credentials: "include" }).then((r) => r.json()),
    )) as { items: Array<{ title: string; unread: number; readSeq: number }> };
    return list.items.find((one) => one.title === "Тихий");
  };

  const quiet = await serverCount();
  expect(quiet?.unread, "фоновая вкладка съела непрочитанное").toBe(1);
  expect(quiet?.readSeq, "фоновая вкладка отправила отметку прочтения").toBe(0);

  // И только теперь — что это видно человеку.
  await openChannel(page, "Общий");
  await expect(channelRow(page, "Тихий")).toContainText("непрочитанных: 1");

  await otherPage.close();
});

test("свои реплики непрочитанными не считаются", async ({ page }) => {
  await register(page);
  await createChannel(page, "Монолог");
  await say(page, "сам себе");

  await openChannel(page, "Общий");
  const row = channelRow(page, "Монолог");
  await expect(row).not.toContainText("непрочитанных:");

  // Поле пустое — значит канал открывался и реплика ушла, а не потерялась.
  await openChannel(page, "Монолог");
  await expect(field(page)).toHaveText("");
});

test("своя реплика уводит ленту вниз, даже если листал историю", async ({ page }) => {
  /**
   * ⚠️ ВЛАДЕЛЕЦ ПОЙМАЛ ЭТО СЛОВАМИ «напечатал, нажал Enter, и меня вниз
   * не перелистнуло». У Телеграма своя реплика уводит ленту в конец
   * ВСЕГДА (`item->isSending()`), и иначе выходит нелепость: отправил
   * и не видишь, что отправил.
   */
  // Низкое окно, чтобы лента переросла экран на десятке реплик, а не
  // на сотне: сценарий про прокрутку, а не про выносливость.
  await page.setViewportSize({ width: 900, height: 400 });
  await register(page);
  await createChannel(page, "Длинный");
  /**
   * ⚠️ БЕЗ `say` НА КАЖДОЙ РЕПЛИКЕ, И ЭТО НЕ ЭКОНОМИЯ. `say` ищет пузырь
   * по тексту, а «реплика 1» содержится и в «реплика 11», и в «реплика
   * 12» — на длинной череде он находит несколько узлов и падает строгим
   * режимом. Слова взяты неповторяющиеся, а доставку ждём один раз,
   * у последней: именно она нужна сценарию.
   */
  const words = ["один", "два", "три", "четыре", "пять", "шесть"];
  for (const word of [...words, ...words.map((one) => `${one} снова`)]) {
    await typeInto(page, word, "Отправить");
  }
  await expect(bubble(page, "шесть снова").getByLabel("доставлено")).toBeVisible();

  // Уходим вверх — так, чтобы последней реплики на экране не было.
  await feedBox(page).evaluate((node) => {
    node.scrollTop = 0;
  });

  /**
   * ⚠️ ЖДЁМ КНОПКУ «В КОНЕЦ ЛЕНТЫ», А НЕ ПРОСТО ПРОВЕРЯЕМ ВИДИМОСТЬ
   * РЕПЛИКИ. После последней отправки лента едет вниз ПЛАВНО, и в полном
   * прогоне эта поездка ещё продолжалась, когда сценарий уже уводил
   * прокрутку наверх: анимация возвращала её обратно, и проверка падала
   * раз через раз. В одиночку — всегда зелено, что и есть худший вид
   * мигания.
   *
   * Кнопка появляется ровно тогда, когда лента НЕ в конце, — то есть
   * это то же условие, но названное видимым человеку признаком,
   * а не мгновением.
   */
  await expect(page.getByLabel("В конец ленты")).toBeVisible();
  await expect(bubble(page, "шесть снова")).not.toBeInViewport();

  await typeInto(page, "после подъёма наверх", "Отправить");

  await expect(
    bubble(page, "после подъёма наверх"),
    "своя реплика не увела ленту вниз",
  ).toBeInViewport();
});
