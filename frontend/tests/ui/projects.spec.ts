import { expect, type Page, test } from "@playwright/test";
import { createChannel, invited, openChannel, register, say } from "./fixtures.js";

/**
 * СЦЕНАРИИ ПРОЕКТОВ (Р-032, task-035).
 *
 * ⚠️ ПРОЕКТ — ЭТО МЕСТО, ГДЕ ЧАТ РОЖДАЕТСЯ, а не папка, куда его потом
 * перекладывают. Разница не косметическая: «завести канал, потом
 * отнести» заставляет человека решать, о чём был разговор, ПОСЛЕ
 * разговора. Владелец показал устройство Codex и назвал верный порядок —
 * сперва называют дело, потом говорят о нём.
 *
 * Перекладывание при этом остаётся: чат может переехать. Оно просто
 * перестало быть единственным путём.
 *
 * Бьёт по собранному образу. Перед запуском: make up
 */

function канал(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

function папка(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Завести проект плюсом в разделе «Проекты» — нашим окном, не браузерным. */
async function завестиПроект(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill(title);
  await page.getByLabel("Название проекта").press("Enter");
  await expect(папка(page, title)).toBeVisible();
}

/** Действие из меню проекта. */
async function вМенюПроекта(page: Page, project: string, пункт: string): Promise<void> {
  await page.getByRole("button", { name: `Что сделать с проектом «${project}»` }).click();
  await page.getByRole("menuitem", { name: пункт }).click();
}

test("чаты без папки лежат сверху, отдельного раздела для них нет", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗАДАЧИ (task-037). Раздела «Каналы» нет —
   * второго СОРТА чатов не бывает. Но и в папку чат никто не загоняет:
   * бездомные лежат простым списком сверху, как несортированные каналы
   * в Дискорде и недавние чаты в Claude.
   *
   * Почему не наоборот (папка обязательна) — Р-033: проект скоро
   * получит своего агента и свою память, и сваленное в общую папку
   * испортит ответы молча.
   */
  // ⚠️ ИЩЕМ ТЕКСТ, А НЕ КНОПКУ: подписи разделов больше не кнопки,
  // и поиск кнопки «Каналы» проходил бы, даже вернись раздел.
  await expect(
    page.getByText("Каналы", { exact: true }),
    "раздел «Каналы» остался в панели",
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Новый чат", exact: true }),
    "чат негде завести без папки",
  ).toBeVisible();

  // Чат регистрации лежит сверху, а не внутри выдуманной папки.
  await expect(канал(page, "Общий")).toBeVisible();
  await expect(папка(page, "Общее"), "завелась папка-свалка").toHaveCount(0);
});

test("над чатами без папки стоит «Недавние», а плюс проектов прячется", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ ПОДПИСЬ, А НЕ ЗАГОЛОВОК РАЗДЕЛА. «Недавние» говорит про ПОРЯДОК,
   * а не про сорт чатов: сортов у нас снова стало бы два, и мы вернулись
   * бы к тому, что убрали в task-037. Так же подписано у Codex.
   */
  await expect(
    page.getByText("Недавние", { exact: true }),
    "чаты без папки лежат без подписи — читаются как ничьи",
  ).toBeVisible();

  /**
   * ⚠️ ПОКА ПРОЕКТОВ НЕТ, ПЛЮС ВИДЕН ВСЕГДА. Он единственный вход
   * в раздел, а на телефоне наведения не бывает — спрятанным его
   * было бы не найти вовсе.
   */
  await expect(
    page.getByRole("button", { name: "Новый проект" }),
    "в пустом разделе плюс спрятан — первый проект нечем завести",
  ).toHaveCSS("opacity", "1");
  await завестиПроект(page, "Объект");
  // Уводим с раздела и мышь, и фокус: окно, закрываясь, возвращает фокус
  // на плюс, а наведение и фокус его показывают. Проверяем же покой.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  /**
   * ⚠️ ПРОВЕРЯЕМ ПРОЗРАЧНОСТЬ, А НЕ ВИДИМОСТЬ: `toBeVisible` не различает
   * прозрачную кнопку и обычную, а разница здесь и есть предмет.
   *
   * Плюс прячется до наведения — так в Buzz и так решил владелец,
   * посмотрев на живой экран (10.09). Днём раньше он же стоял постоянно;
   * запись об этом колебании лежит в самом компоненте, чтобы мы не
   * ходили по кругу.
   */
  await expect(
    page.getByRole("button", { name: "Новый проект" }),
    "плюс проектов виден без наведения — он забирает внимание у списка",
  ).toHaveCSS("opacity", "0");
});

test("чат уходит из папки наверх и возвращается обратно", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  // Новый чат рождается общим входом, затем его относят к проекту. У проекта
  // нет фальшивого плюса — это закреплено соседним сценарием ниже.
  await createChannel(page, "Смета");

  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Убрать из проекта" }).click();

  const снаружи = await page.evaluate(async () => {
    const ответ = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    return ответ.items.find((one: { title: string }) => one.title === "Смета")?.projectId ?? null;
  });
  expect(снаружи, "чат не вышел из папки — а выйти ему теперь есть куда").toBeNull();
  await expect(канал(page, "Смета"), "вышедший из папки чат пропал из панели").toBeVisible();
});

test("закреплённый чат стоит выше и переживает перезагрузку", async ({ page }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Редкий");
  await createChannel(page, "Свежий");

  /**
   * ⚠️ СРАВНИВАЕМ ПОЛОЖЕНИЕ НА ЭКРАНЕ, А НЕ ОТВЕТ СЕРВЕРА. Что порядок
   * приходит верным, проверяет приёмочный; здесь проверяется то, ради
   * чего человек нажимает булавку, — что закреплённое ВИДНО выше.
   */
  const сверху = async (title: string) => {
    const box = await канал(page, title).boundingBox();
    if (!box) throw new Error(`строки «${title}» нет на экране`);
    return box.y;
  };

  expect(await сверху("Свежий"), "свежий и так не сверху").toBeLessThan(await сверху("Редкий"));

  await page.getByRole("button", { name: "Что сделать с каналом «Редкий»" }).click();
  await page.getByRole("menuitem", { name: "Закрепить" }).click();

  await expect
    .poll(async () => (await сверху("Редкий")) < (await сверху("Свежий")), {
      message: "закреплённый чат не поднялся",
    })
    .toBe(true);

  // ⚠️ ПЕРЕЗАГРУЗКА — ЭТО ПРОВЕРКА, ЧТО ЗАКРЕПЛЕНИЕ ЖИВЁТ НА СЕРВЕРЕ,
  // а не в памяти вкладки. Иначе оно исчезло бы к утру.
  await page.reload();
  await expect(канал(page, "Редкий")).toBeVisible();
  expect(
    await сверху("Редкий"),
    "закрепление не пережило перезагрузку — значит его не сохранили",
  ).toBeLessThan(await сверху("Свежий"));
});

test("у проектов свой раздел и свой плюс", async ({ page }) => {
  await register(page, "Хозяин");

  /**
   * ⚠️ РАЗДЕЛ «ПРОЕКТЫ» ВИДЕН ВСЕГДА, ДАЖЕ ПУСТОЙ, И ЭТО ОТСТУПЛЕНИЕ
   * ОТ ПЛАНА. План обещал: у кого проектов нет — панель как прежде.
   * При сборке выяснилось, что тогда первый проект нечем завести:
   * плюс живёт в заголовке раздела, а раздела нет. Прятать вход
   * от того, у кого ещё ничего нет, — значит прятать саму возможность.
   * Цена отступления — одна строка заголовка; у Codex этот раздел
   * тоже стоит всегда.
   */
  const пусто = page.getByText("Проектов нет. Заведите первый — плюс справа от подписи.");
  await expect(пусто, "пустой раздел проектов не объясняет себя").toBeVisible();

  await завестиПроект(page, "Объект");

  await expect(пусто, "подсказка осталась при заведённом проекте").toHaveCount(0);
});

test("у папки свой значок и свой цвет, и они переживают перезагрузку", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Объект");
  await page.getByRole("button", { name: "Настроить вид" }).click();
  await page.getByRole("button", { name: "Портфель" }).click();
  await page.getByRole("button", { name: "Оранжевый" }).click();
  await page.getByRole("button", { name: "Создать проект" }).click();

  await expect(папка(page, "Объект")).toBeVisible();

  /**
   * ⚠️ ПРОВЕРЯЕМ, ЧТО ВЫБОР ДОЕХАЛ ДО СЕРВЕРА, А НЕ ЧТО КАРТИНКА
   * ИЗМЕНИЛАСЬ. «Значок стал другим» — слабое утверждение: он мог
   * измениться и в одной вкладке. Настоящее свойство одно: вид папки
   * сохранён и вернётся завтра.
   */
  const вид = await page.evaluate(async () => {
    const ответ = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const свой = ответ.projects.find((one: { title: string }) => one.title === "Объект");
    return { icon: свой?.icon ?? null, color: свой?.color ?? null };
  });
  expect(вид, "выбранный вид папки не сохранился").toEqual({ icon: "briefcase", color: "orange" });

  await вМенюПроекта(page, "Объект", "Закрепить");
  const значки = await папка(page, "Объект")
    .locator("svg")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("class") ?? ""));
  expect(значки, "закрепление подменило портфель скрепкой").toContain("size-4");
  expect(значки.join(" "), "закрепление нарисовало скрепку").not.toContain("push-pin");

  await page.reload();
  await expect(папка(page, "Объект"), "папка пропала после перезагрузки").toBeVisible();
});

test("чат можно отнести в проект из рабочего меню", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  // Чат заводится общим рабочим входом, затем относится в проект действием
  // «В проект»; отдельного плюса в строке проекта нет.
  await createChannel(page, "Смета");
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  await expect(канал(page, "Смета")).toBeVisible();

  /**
   * ⚠️ ПРОВЕРЯЕМ ПРИНАДЛЕЖНОСТЬ, А НЕ КАРТИНКУ. «Виден в панели» — слабое
   * утверждение: он виден и снаружи проекта. Настоящее свойство одно —
   * чат отнесён к проекту, и его говорит сервер.
   */
  const принадлежность = await page.evaluate(async () => {
    const ответ = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const чат = ответ.items.find((one: { title: string }) => one.title === "Смета");
    const проект = ответ.projects.find((one: { title: string }) => one.title === "Объект");
    return { чат: чат?.projectId ?? null, проект: проект?.id ?? null };
  });
  expect(принадлежность.чат, "чат завели внутри проекта, а он оказался снаружи").toBe(
    принадлежность.проект,
  );
});

test("проект переименовывается, и это видно во второй вкладке", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await createChannel(page, "Смета");
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await expect(папка(другой, "Объект")).toBeVisible();

  await вМенюПроекта(page, "Объект", "Редактировать проект");
  await page.getByLabel("Название проекта").fill("Второй объект");
  await page.getByLabel("Название проекта").press("Enter");

  await expect(папка(page, "Второй объект")).toBeVisible();
  await expect(папка(другой, "Второй объект"), "переименование не доехало").toBeVisible();
});

test("у проекта нет плюса, а меню оставляет только работающие действия", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  await expect(page.getByRole("button", { name: "Новый чат в проекте «Объект»" })).toHaveCount(0);
  await page.getByRole("button", { name: "Что сделать с проектом «Объект»" }).click();
  await expect(page.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Редактировать проект" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Убрать проект" })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
});

test("карандаш проекта открывает существующее редактирование", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");

  const строкаПроекта = папка(page, "Объект");
  await строкаПроекта.hover();
  await page.getByRole("button", { name: "Редактировать проект «Объект»" }).click();
  await expect(page.getByRole("heading", { name: "Редактировать проект" })).toBeVisible();
});

test("новый проект спрашивает имя до необязательной настройки вида", async ({ page }) => {
  await register(page, "Хозяин");
  await page.getByRole("button", { name: "Новый проект" }).click();

  await expect(page.getByRole("button", { name: "Настроить вид" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Портфель" })).toHaveCount(0);
  await page.getByRole("button", { name: "Настроить вид" }).click();
  await expect(page.getByRole("button", { name: "Портфель" })).toBeVisible();
  await expect(page.getByLabel("Название проекта")).toHaveCSS("border-top-width", "2px");
});

test("убрать проект — переписка цела и лежит снаружи", async ({ page }) => {
  await register(page, "Хозяин");
  await завестиПроект(page, "Объект");
  await createChannel(page, "Смета");
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await openChannel(page, "Смета");
  await say(page, "важные слова");

  await вМенюПроекта(page, "Объект", "Убрать проект");
  // ⚠️ СПРАШИВАЕМ, И В ВОПРОСЕ СКАЗАНО, ЧТО ЧАТЫ ОСТАНУТСЯ. Иначе слово
  // «убрать» человек прочтёт как «удалить переписку».
  await expect(page.getByText(/чаты останутся/u)).toBeVisible();
  await page.getByRole("button", { name: "Убрать" }).click();

  await expect(папка(page, "Объект"), "проект остался в панели").toHaveCount(0);
  await expect(канал(page, "Смета"), "чат исчез вместе с папкой").toBeVisible();
  await openChannel(page, "Смета");
  await expect(page.getByText("важные слова"), "переписка пропала").toBeVisible();
});

test("свёрнутый проект показывает, что внутри новое", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");

  const другой = await browser.newPage();
  await invited(другой, page, "Коллега");
  await openChannel(другой, "Общий");

  await завестиПроект(page, "Объект");
  await page.getByRole("button", { name: "Что сделать с каналом «Смета»" }).click();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  await openChannel(page, "Смета");
  await say(page, "первая реплика");
  await say(page, "вторая реплика");

  /**
   * ⚠️ КОЛЛЕГА СМОТРИТ В ДРУГОЙ ЧАТ И СВОРАЧИВАЕТ ПАПКУ. Открой он
   * «Смету» — сработали бы три условия отметки (Р-029), всё погасло бы,
   * и проверять стало бы нечего.
   */
  const свёрток = папка(другой, "Объект");
  await expect(свёрток).toBeVisible();
  await expect(канал(другой, "Смета"), "чат проекта не виден развёрнутым").toBeVisible();

  await свёрток.click();
  await expect(канал(другой, "Смета"), "проект свернулся, а чат остался на виду").toBeHidden();
  await expect(
    свёрток,
    "свёрнутая папка молчит о новом — сворачивать её никто не станет",
  ).toHaveAccessibleName(/непрочитанных: 2/u);
});
