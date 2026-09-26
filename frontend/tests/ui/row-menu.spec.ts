import { createChannel, inviteToken, joinVoice, register } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * ДЕЙСТВИЯ СТРОКИ ПАНЕЛИ — ПРАВОЙ КНОПКОЙ (task-102) И КНОПКОЙ НАСТРОЕК.
 *
 * Владелец 17.09 отменил своё прежнее решение (task-059): три точки
 * и булавка с корзиной убираются, число непрочитанного встаёт к краю,
 * а «Закрепить / В проект / Удалить» живут в меню по правой кнопке —
 * у любого чата одинаково, у проекта так же.
 *
 * ⚠️ 26.09 ВЛАДЕЛЕЦ ВЕРНУЛ КНОПКУ: у чата три точки, у проекта значок
 * настроек после плюса. Правая кнопка осталась. Кнопка открывает ТО ЖЕ
 * меню. Точки видны при наведении, рядом с числом; без наведения число у края.
 */

test.describe.configure({ timeout: 120_000 });

function row(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`, "u") });
}

/**
 * Строка панели встала на место: две подряд одинаковые координаты.
 *
 * ⚠️ ЗДЕСЬ БЫЛ `waitForLoadState("networkidle")`, И ОН НЕ НАСТУПАЕТ НИКОГДА
 * (Д-54). Живые обновления держат `/v1/stream` открытым всё время жизни
 * вкладки, а «сеть затихла» для Playwright значит «ни одного запроса
 * в полёте полсекунды». Незавершающийся запрос ровно один — и его хватает.
 * Ожидание молча выедало полный срок сценария и красило его на исправном
 * коде; в трёх полных прогонах подряд оно стоило по две минуты каждый.
 *
 * Ждём то, ради чего ожидание и ставилось: строка перестала ехать.
 */
async function settled(page: Page, title: string): Promise<void> {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const at = Math.round((await row(page, title).boundingBox())?.y ?? Number.NaN);
        const same = Number.isFinite(at) && at === previous;
        previous = at;
        return same;
      },
      { message: `строка «${title}» не встала на место` },
    )
    .toBe(true);
}

/** Завести проект запросом: здесь проверяется меню, а не окно заводки. */
async function project(page: Page, title: string): Promise<string> {
  const made = await page.evaluate(async (name) => {
    const response = await fetch("/v1/projects", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: name }),
    });
    return (await response.json()) as { id: string };
  }, title);
  return made.id;
}

/** Состояние строки — значок слева (Р-044): none · unread · mention · pinned. */
function status(page: Page, title: string) {
  return row(page, title).locator("[data-status]");
}

/** Видимые глазу числа в строке: подпись для читалки сюда не входит. */
async function shownDigits(page: Page, title: string): Promise<string[]> {
  return row(page, title).evaluate((button) =>
    [...button.querySelectorAll("*")]
      .filter((one) => !one.closest(".sr-only") && one.children.length === 0)
      .map((one) => (one.textContent ?? "").trim())
      .filter((text) => /^@?\d+\+?$/u.test(text)),
  );
}

test("состояние чата — значком слева, без чисел; наведение ничего не сдвигает", async ({
  page,
  playwright,
}) => {
  /**
   * ⚠️ Р-044 (владелец 26.09): плашки с числами справа «очень плохо
   * смотрятся», а точки при наведении сдвигали их — строка прыгала.
   */
  const me = await register(page, "Хозяин");
  await createChannel(page, "Смета");
  const smeta = new URL(page.url()).pathname.split("/")[2] ?? "";
  await createChannel(page, "Зов");
  const call = new URL(page.url()).pathname.split("/")[2] ?? "";
  // Открыт другой чат: реплика в открытом сразу стала бы прочитанной.
  await createChannel(page, "Другой");
  const folder = await project(page, "Объект");
  const inside = (await (
    await page.request.post("/v1/conversations", { data: { title: "Внутри", projectId: folder } })
  ).json()) as { id: string };
  await page.reload();

  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  const say = async (room: string, body: string) => {
    const said = await guest.post(`/v1/conversations/${room}/messages`, {
      data: { body, clientMsgId: crypto.randomUUID() },
    });
    expect(said.ok(), `реплика «${body}» не ушла: ${said.status()}`).toBe(true);
  };
  await say(smeta, "посмотри смету");
  await say(smeta, "и ещё строку");
  const people = (await (await guest.get(`/v1/conversations/${call}/people`)).json()) as {
    items: Array<{ id: string; name: string }>;
  };
  const owner = people.items.find((one) => one.name === me.name)?.id ?? "";
  await say(call, `[${me.name}](@${owner}) глянь`);
  await say(inside.id, "в папке тоже новое");
  await guest.dispose();

  // П-1: новое — точка слева и жирное название; число не видно глазу,
  // но осталось для читалки.
  await expect(status(page, "Смета")).toHaveAttribute("data-status", "unread");
  await expect(row(page, "Смета")).toContainText("непрочитанных: 2");
  expect(await shownDigits(page, "Смета"), "в строке видно число").toEqual([]);
  const weight = await row(page, "Смета")
    .locator("span.truncate")
    .evaluate((one) => Number(getComputedStyle(one).fontWeight));
  expect(weight, "название с новым не жирное").toBeGreaterThanOrEqual(500);

  // П-2: позвали — знак зова слева; нет нового — пустой кружок.
  await expect(status(page, "Зов")).toHaveAttribute("data-status", "mention");
  await expect(status(page, "Другой")).toHaveAttribute("data-status", "none");

  // П-3: свёрнутая папка с новым внутри — тоже без чисел.
  // ⚠️ С ПЕРЕЗАГРУЗКОЙ: живьём число папки, чьи чаты ни разу не раскрывали,
  // не приезжает вовсе — это Д-65, старый разрыв, а не вид. Здесь проверяется вид.
  await page.reload();
  await expect(row(page, "Объект")).toHaveAttribute("aria-expanded", "false");
  expect(await shownDigits(page, "Объект"), "у папки видно число").toEqual([]);
  await expect(row(page, "Объект").locator("[data-status]")).toHaveAttribute(
    "data-status",
    "unread",
  );

  // П-4: наведение ничего не сдвигает — ни название, ни значок слева,
  // а точки появляются в уже отведённом месте.
  const dots = page.getByRole("button", { name: "Настройки чата «Смета»" });
  await expect(dots).toBeHidden();
  const place = async () => ({
    title: await row(page, "Смета").locator("span.truncate").boundingBox(),
    mark: await status(page, "Смета").boundingBox(),
    // Скрытая кнопка не входит в дерево доступности — мерим с учётом скрытых.
    dots: await page
      .getByRole("button", { name: "Настройки чата «Смета»", includeHidden: true })
      .boundingBox(),
  });
  const before = await place();
  await row(page, "Смета").hover();
  await expect(dots).toBeVisible();
  const after = await place();
  expect(after.title?.x, "название сдвинулось").toBe(before.title?.x);
  expect(after.title?.width, "название сжалось").toBe(before.title?.width);
  expect(after.mark?.x, "значок сдвинулся").toBe(before.mark?.x);
  expect(after.dots?.x, "точки встали не на своё место").toBe(before.dots?.x);
});

test("у любого чата одно меню по правой кнопке, и пункты работают", async ({ page }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");
  await createChannel(page, "Редкий");
  await project(page, "Объект");
  await page.reload();

  // Вне проекта: «В проект» → «Объект».
  await row(page, "Смета").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Удалить чат" })).toBeVisible();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await page.getByRole("menuitem", { name: "Объект", exact: true }).click();
  await expect(row(page, "Объект")).toHaveAttribute("aria-expanded", "true");

  // ⚠️ ЖДЁМ, ПОКА ПАНЕЛЬ ВСТАНЕТ НА МЕСТО. Перенос двигает строку в папку,
  // а панель следом перечитывается: меню, открытое над едущей строкой,
  // Radix переставляет, и Playwright не дожидается «устойчивого» пункта.
  // Поймано миганием в пачке прогонов (task-106, 18.09).
  await settled(page, "Смета");

  // В проекте — то же меню, с «Убрать из проекта».
  await row(page, "Смета").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Удалить чат" })).toBeVisible();
  await page.getByRole("menuitem", { name: "В проект" }).click();
  await expect(page.getByRole("menuitem", { name: "Убрать из проекта" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Закрепить: самый старый «Общий» встаёт выше свежего «Редкого».
  await row(page, "Общий").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Закрепить" }).click();
  await expect
    .poll(
      async () => {
        const pinned = await row(page, "Общий").boundingBox();
        const fresh = await row(page, "Редкий").boundingBox();
        return (pinned?.y ?? 0) < (fresh?.y ?? 0);
      },
      { message: "закреплённый не встал выше" },
    )
    .toBe(true);

  // Удалить — через три точки: то же меню, спрашивает подтверждение.
  await row(page, "Редкий").hover();
  await page.getByRole("button", { name: "Настройки чата «Редкий»" }).click();
  await expect(page.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Удалить чат" }).click();
  await expect(page.getByRole("dialog")).toContainText("Удалить «Редкий»?");
});

test("у проекта меню правой кнопкой, значком настроек и с клавиатуры", async ({ page }) => {
  await register(page, "Хозяин");
  await project(page, "Объект");
  await page.reload();

  await row(page, "Объект").click({ button: "right" });
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["Закрепить", "Редактировать проект", "Убрать проект"]);
  await page.keyboard.press("Escape");

  // Значок настроек — после плюса и открывает то же меню.
  await row(page, "Объект").hover();
  const plus = page.getByRole("button", { name: "Новый чат в проекте «Объект»" });
  const gear = page.getByRole("button", { name: "Настройки проекта «Объект»" });
  await expect(gear).toBeVisible();
  const plusAt = (await plus.boundingBox())?.x ?? 0;
  const gearAt = (await gear.boundingBox())?.x ?? 0;
  expect(gearAt, "значок настроек не после плюса").toBeGreaterThan(plusAt);
  await gear.click();
  await expect(items).toHaveText(["Закрепить", "Редактировать проект", "Убрать проект"]);
  await page.keyboard.press("Escape");

  await row(page, "Объект").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Редактировать проект" })).toBeVisible();
});
