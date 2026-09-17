import { expect, type Page, test } from "@playwright/test";
import { createChannel, invited, openChannel, register, rowMenu, say } from "./fixtures.js";

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

function channelRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

function folderRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

/** Завести проект плюсом в разделе «Проекты» — нашим окном, не браузерным. */
async function createProject(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill(title);
  await page.getByLabel("Название проекта").press("Enter");
  await expect(folderRow(page, title)).toBeVisible();
}

/** Действие из меню проекта — правой кнопкой по строке (task-102). */
async function inProjectMenu(page: Page, project: string, item: string): Promise<void> {
  await rowMenu(page, project);
  await page.getByRole("menuitem", { name: item }).click();
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
  await expect(channelRow(page, "Общий")).toBeVisible();
  await expect(folderRow(page, "Общее"), "завелась папка-свалка").toHaveCount(0);
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
});

test("чат без проекта можно отнести в проект", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  // Новый чат рождается общим входом, затем его относят к проекту. У проекта
  // нет фальшивого плюса — это закреплено соседним сценарием ниже.
  await createChannel(page, "Смета");

  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  /**
   * ⚠️ ЖДЁМ ОТВЕТ НА ПЕРЕНОС, А НЕ СПРАШИВАЕМ СЕРВЕР СРАЗУ ПОСЛЕ ЩЕЛЧКА
   * (task-098). Вопрос уходил вдогонку за самим переносом и в долгом прогоне
   * успевал раньше записи: два падения из пяти на исправном коде. Та же
   * порода, что Д-26 и Д-27: проверяем само действие, а не миг после щелчка.
   */
  const moved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/v1/conversations/"),
  );
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await moved;
  const belonging = await page.evaluate(async () => {
    const response = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const channel = response.items.find((one: { title: string }) => one.title === "Смета");
    const project = response.projects.find((one: { title: string }) => one.title === "Объект");
    return { channel: channel?.projectId ?? null, project: project?.id ?? null };
  });
  expect(belonging.channel, "чат не оказался внутри выбранного проекта").toBe(belonging.project);
  await expect(channelRow(page, "Смета"), "чат внутри проекта пропал из панели").toBeVisible();
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
  const firstTitle = async (title: string) => {
    const box = await channelRow(page, title).boundingBox();
    if (!box) throw new Error(`строки «${title}» нет на экране`);
    return box.y;
  };

  expect(await firstTitle("Свежий"), "свежий и так не сверху").toBeLessThan(
    await firstTitle("Редкий"),
  );

  await rowMenu(page, "Редкий");
  await page.getByRole("menuitem", { name: "Закрепить" }).click();

  await expect
    .poll(async () => (await firstTitle("Редкий")) < (await firstTitle("Свежий")), {
      message: "закреплённый чат не поднялся",
    })
    .toBe(true);

  // ⚠️ ПЕРЕЗАГРУЗКА — ЭТО ПРОВЕРКА, ЧТО ЗАКРЕПЛЕНИЕ ЖИВЁТ НА СЕРВЕРЕ,
  // а не в памяти вкладки. Иначе оно исчезло бы к утру.
  await page.reload();
  await expect(channelRow(page, "Редкий")).toBeVisible();
  expect(
    await firstTitle("Редкий"),
    "закрепление не пережило перезагрузку — значит его не сохранили",
  ).toBeLessThan(await firstTitle("Свежий"));
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
  const empty = page.getByText("Проектов нет. Заведите первый — плюс справа от подписи.");
  await expect(empty, "пустой раздел проектов не объясняет себя").toBeVisible();

  await createProject(page, "Объект");

  await expect(empty, "подсказка осталась при заведённом проекте").toHaveCount(0);
});

test("плюс проекта появляется только при наведении на строку раздела", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  const add = page.getByRole("button", { name: "Новый проект" });
  // Уводим курсор на другую строку панели: после закрытия модалки он может
  // остаться в месте, которое физически оказалось под заголовком проектов.
  await page.getByRole("button", { name: "Новый чат", exact: true }).hover();
  await expect(add).toHaveCSS("opacity", "0");

  // Курсор именно на строке проекта, а не на всей секции. Если hover-группа
  // останется на `section`, эта проверка пропустит утечку действия в список.
  await folderRow(page, "Объект").hover();
  await expect(add).toHaveCSS("opacity", "0");

  await page.getByText("Проекты", { exact: true }).hover();
  await expect(add).toHaveCSS("opacity", "1");
});

test("наведение на чат не показывает действия его проекта", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");
  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового чата").fill("Смета");
  await page.getByLabel("Название нового чата").press("Enter");

  const project = folderRow(page, "Объект");
  const addToProject = page.getByRole("button", { name: "Новый чат в проекте «Объект»" });

  await channelRow(page, "Смета").hover();
  await expect(addToProject, "у чата не должно быть плюса проекта").toHaveCSS("opacity", "0");

  await project.hover();
  await expect(addToProject).toHaveCSS("opacity", "1");
});

test("у папки свой значок и свой цвет, и они переживают перезагрузку", async ({ page }) => {
  await register(page, "Хозяин");

  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Объект");
  await page.getByRole("button", { name: "Значок и цвет проекта" }).click();
  await page.getByRole("button", { name: "Портфель" }).click();
  await page.getByRole("button", { name: "Оранжевый" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Создать проект" }).click();

  await expect(folderRow(page, "Объект")).toBeVisible();

  /**
   * ⚠️ ПРОВЕРЯЕМ, ЧТО ВЫБОР ДОЕХАЛ ДО СЕРВЕРА, А НЕ ЧТО КАРТИНКА
   * ИЗМЕНИЛАСЬ. «Значок стал другим» — слабое утверждение: он мог
   * измениться и в одной вкладке. Настоящее свойство одно: вид папки
   * сохранён и вернётся завтра.
   */
  const look = await page.evaluate(async () => {
    const response = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const own = response.projects.find((one: { title: string }) => one.title === "Объект");
    return { icon: own?.icon ?? null, color: own?.color ?? null };
  });
  expect(look, "выбранный вид папки не сохранился").toEqual({
    icon: "briefcase",
    color: "#b86d1e",
  });

  await inProjectMenu(page, "Объект", "Закрепить");
  const badges = await folderRow(page, "Объект")
    .locator("svg")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("class") ?? ""));
  expect(badges, "закрепление подменило портфель скрепкой").toContain("size-4");
  expect(badges.join(" "), "закрепление нарисовало скрепку").not.toContain("push-pin");

  await page.reload();
  await expect(folderRow(page, "Объект"), "папка пропала после перезагрузки").toBeVisible();
});

test("чат можно отнести в проект из рабочего меню", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  // Чат заводится общим рабочим входом, затем относится в проект действием
  // «В проект»; отдельного плюса в строке проекта нет.
  await createChannel(page, "Смета");
  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  await expect(channelRow(page, "Смета")).toBeVisible();

  /**
   * ⚠️ ПРОВЕРЯЕМ ПРИНАДЛЕЖНОСТЬ, А НЕ КАРТИНКУ. «Виден в панели» — слабое
   * утверждение: он виден и снаружи проекта. Настоящее свойство одно —
   * чат отнесён к проекту, и его говорит сервер.
   */
  const membership = await page.evaluate(async () => {
    const response = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const chat = response.items.find((one: { title: string }) => one.title === "Смета");
    const project = response.projects.find((one: { title: string }) => one.title === "Объект");
    return { chat: chat?.projectId ?? null, project: project?.id ?? null };
  });
  expect(membership.chat, "чат завели внутри проекта, а он оказался снаружи").toBe(
    membership.project,
  );
});

test("проект переименовывается, и это видно во второй вкладке", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Коллега");
  await createChannel(page, "Смета");
  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await expect(folderRow(otherPage, "Объект")).toBeVisible();

  await inProjectMenu(page, "Объект", "Редактировать проект");
  await page.getByLabel("Название проекта").fill("Второй объект");
  await page.getByLabel("Название проекта").press("Enter");

  await expect(folderRow(page, "Второй объект")).toBeVisible();
  await expect(folderRow(otherPage, "Второй объект"), "переименование не доехало").toBeVisible();
});

test("у проекта меню правой кнопкой и настоящий плюс нового чата", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  await expect(page.getByRole("button", { name: "Редактировать проект «Объект»" })).toHaveCount(0);
  const add = page.getByRole("button", { name: "Новый чат в проекте «Объект»" });
  await expect(add).toBeVisible();
  await rowMenu(page, "Объект");
  await expect(page.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Редактировать проект" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Убрать проект" })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
});

test("плюс проекта создаёт и открывает чат сразу внутри него", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");

  const project = folderRow(page, "Объект");
  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
  await page.getByLabel("Название нового чата").fill("Смета");
  await page.getByLabel("Название нового чата").press("Enter");
  await expect(
    project,
    "созданный чат не должен оставаться спрятан в свёрнутом проекте",
  ).toHaveAttribute("aria-expanded", "true");
  await expect(channelRow(page, "Смета")).toBeVisible();

  const belonging = await page.evaluate(async () => {
    const response = await fetch("/v1/conversations", { credentials: "include" }).then((r) =>
      r.json(),
    );
    const channel = response.items.find((one: { title: string }) => one.title === "Смета");
    const project = response.projects.find((one: { title: string }) => one.title === "Объект");
    return { channel: channel?.projectId ?? null, project: project?.id ?? null };
  });
  expect(belonging.channel, "плюс завёл чат вне проекта").toBe(belonging.project);
});

test("вид проекта выбирается поповером, а не стеной в окне", async ({ page }) => {
  await register(page, "Хозяин");
  await page.getByRole("button", { name: "Новый проект" }).click();

  // ⚠️ В ОКНЕ ТОЛЬКО ИМЯ И ОБРАЗЕЦ (владелец, тыкалка 17.09: «вид данного
  // модального окна полностью переделай»). Значки и цвета — в поповере.
  await expect(page.getByRole("button", { name: "Портфель" })).toHaveCount(0);
  await page.getByRole("button", { name: "Значок и цвет проекта" }).click();
  await expect(page.getByRole("button", { name: "Портфель" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Оранжевый" })).toBeVisible();
});

test("убрать проект — переписка цела и лежит снаружи", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");
  await createChannel(page, "Смета");
  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await openChannel(page, "Смета");
  await say(page, "важные слова");

  await inProjectMenu(page, "Объект", "Убрать проект");
  // ⚠️ СПРАШИВАЕМ, И В ВОПРОСЕ СКАЗАНО, ЧТО ЧАТЫ ОСТАНУТСЯ. Иначе слово
  // «убрать» человек прочтёт как «удалить переписку».
  await expect(page.getByText(/чаты останутся/u)).toBeVisible();
  await page.getByRole("button", { name: "Убрать" }).click();

  await expect(folderRow(page, "Объект"), "проект остался в панели").toHaveCount(0);
  await expect(channelRow(page, "Смета"), "чат исчез вместе с папкой").toBeVisible();
  await openChannel(page, "Смета");
  await expect(page.getByText("важные слова"), "переписка пропала").toBeVisible();
});

test("проект закрывается и заново входит через CSS transition без rAF", async ({ page }) => {
  await register(page, "Хозяин");
  await createProject(page, "Объект");
  await createChannel(page, "Смета");
  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  const project = folderRow(page, "Объект");
  // Сначала дожидаемся результата переноса: чаты папки приезжают своей
  // порцией (Р-037), и сворачивать пустую папку нечему.
  await expect(channelRow(page, "Смета")).toBeVisible();
  await project.click();
  // ⚠️ ЗАКРЫТИЕ ПРОВЕРЯЕТСЯ ВИДИМЫМ ИТОГОМ, А НЕ САМИМ УЗЛОМ. Закрытое тело
  // живёт ровно столько, сколько идёт переход (200 мс), и уходит со страницы:
  // ради этого task-064 и делался — сто свёрнутых папок держали 51 600
  // невидимых элементов. Ждать от него состояния «closed» значит ловить
  // мгновение, а не поведение.
  await expect(channelRow(page, "Смета")).toBeHidden();

  await project.click();
  const body = project.locator("xpath=../following-sibling::*[@data-slot='project-chats']");
  await expect(body).toHaveAttribute("data-state", "open");
  await expect(channelRow(page, "Смета")).toBeVisible();
});

test("раскрытый проект сдвигает «Недавние» ниже всех своих чатов и при крупном тексте", async ({
  page,
}) => {
  await register(page, "Хозяин");
  // В обычном высоком окне дефект может не проявиться: flex-контейнеру
  // хватает места и сжимать секции незачем. Низкое окно — тот же случай,
  // что раскрытая панель с несколькими проектами или крупным текстом.
  await page.setViewportSize({ width: 800, height: 420 });
  await createProject(page, "Объект");

  // Несколько рядов заполняют короткую панель. На одном или двух flex ещё
  // не вынужден сжимать секции и ошибка потока не проявляется.
  for (const title of ["Смета", "Договор", "Счета", "Акт", "Отчёт"]) {
    await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
    await page.getByLabel("Название нового чата").fill(title);
    await page.getByLabel("Название нового чата").press("Enter");
  }

  // Та же шкала, что доступна человеку в «Внешнем виде». Не приближаем
  // страницу браузером: zoom меняет ещё и ширину, а здесь проверяется именно
  // рост строк интерфейса от наших переменных.
  await page.evaluate(() => {
    const sizes = {
      "--fs-mark": 13.75,
      "--fs-aside": 15,
      "--fs-body": 17.5,
      "--fs-lead": 20,
      "--fs-head": 25,
      "--fs-brand": 30,
    };
    for (const [name, size] of Object.entries(sizes)) {
      document.documentElement.style.setProperty(name, `${size}px`);
    }
  });

  const project = folderRow(page, "Объект");
  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "false");
  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "true");

  // Не ждём выдуманные 200 мс: проверяем видимый итог, который наступает
  // после перехода на любой скорости машины.
  await expect
    .poll(
      async () => {
        const lastChat = await channelRow(page, "Отчёт").boundingBox();
        const recent = await page.getByText("Недавние", { exact: true }).boundingBox();
        if (!lastChat || !recent) return false;
        return recent.y >= lastChat.y + lastChat.height;
      },
      { message: "«Недавние» налезли на раскрытые чаты проекта" },
    )
    .toBe(true);
});

test("проект раскрывается без движения при системном запрете анимации", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await register(page, "Хозяин");
  await createProject(page, "Объект");
  await createChannel(page, "Смета");
  await rowMenu(page, "Смета");
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();

  const project = folderRow(page, "Объект");
  await project.click();
  await expect(channelRow(page, "Смета")).toBeHidden();

  await project.click();
  const body = project.locator("xpath=../following-sibling::*[@data-slot='project-chats']");
  await expect(body).toHaveAttribute("data-state", "open");
  await expect(body).toHaveCSS("animation-name", "none");
});

test("свёрнутый проект показывает, что внутри новое", async ({ page, browser }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");

  const otherPage = await browser.newPage();
  await invited(otherPage, page, "Коллега");
  await openChannel(otherPage, "Общий");

  await createProject(page, "Объект");
  await rowMenu(page, "Смета");
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
  const folder = folderRow(otherPage, "Объект");
  await expect(folder).toBeVisible();
  await expect(channelRow(otherPage, "Смета"), "чат проекта не виден развёрнутым").toBeVisible();

  await folder.click();
  await expect(
    channelRow(otherPage, "Смета"),
    "проект свернулся, а чат остался на виду",
  ).toBeHidden();
  await expect(
    folder,
    "свёрнутая папка молчит о новом — сворачивать её никто не станет",
  ).toHaveAccessibleName(/непрочитанных: 2/u);
});

/**
 * Панель растёт порциями (Р-037, task-064): чаты папки приезжают по десять,
 * дальше по двадцать пять, «Недавние» — когда долистали до низа. Без этого
 * сто проектов по сотне чатов приезжали одним ответом на каждое сообщение.
 */
test("папка показывает первые десять чатов и строку «Показать ещё»", async ({ page }) => {
  await register(page, "Порции");
  await createProject(page, "Объект");
  for (let number = 1; number <= 12; number += 1) {
    await page.getByRole("button", { name: "Новый чат в проекте «Объект»" }).click();
    await page.getByLabel("Название нового чата").fill(`Чат ${number}`);
    await page.getByLabel("Название нового чата").press("Enter");
  }
  await page.reload();

  const more = page.getByRole("button", { name: "Показать ещё" });
  await expect(more, "первая порция не ограничена — панель снова тянет всё").toBeVisible();
  await expect.poll(async () => await page.getByRole("button", { name: /^Чат / }).count()).toBe(10);

  await more.click();
  await expect
    .poll(async () => await page.getByRole("button", { name: /^Чат / }).count(), {
      message: "«Показать ещё» не привёл следующую порцию",
    })
    .toBe(12);
  await expect(more, "порции кончились, а строка осталась").toHaveCount(0);
});

test("«Недавние» догружаются, когда панель долистали до низа", async ({ page }) => {
  await register(page, "Низ");
  for (let number = 1; number <= 27; number += 1) {
    await createChannel(page, `Свежий ${number}`);
  }
  await page.reload();

  const rows = page.getByRole("button", { name: /^Свежий / });
  await expect
    .poll(async () => await rows.count(), { message: "первая порция не ограничена" })
    .toBe(25);

  // Листаем панель вниз — ровно то, что делает человек.
  await page
    .locator("div.hide-scroll.overflow-y-auto")
    .first()
    .evaluate((box) => {
      box.scrollTop = box.scrollHeight;
    });

  await expect
    .poll(async () => await rows.count(), { message: "низ показался, а порция не приехала" })
    .toBeGreaterThan(25);
});
