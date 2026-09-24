import { expect, type Page, test } from "@playwright/test";
import { createChannel, inviteToken, joinVoice, register } from "./fixtures.js";

/**
 * ДЕЙСТВИЯ СТРОКИ ПАНЕЛИ — ПРАВОЙ КНОПКОЙ (task-102). Написан ДО правки
 * и обязан быть красным.
 *
 * Владелец 17.09 отменил своё прежнее решение (task-059): три точки
 * и булавка с корзиной убираются, число непрочитанного встаёт к краю,
 * а «Закрепить / В проект / Удалить» живут в меню по правой кнопке —
 * у любого чата одинаково, у проекта так же.
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

test("у строк нет точек и кнопок, число — у правого края", async ({ page, playwright }) => {
  await register(page, "Хозяин");
  await createChannel(page, "Смета");
  const room = new URL(page.url()).pathname.split("/")[2] ?? "";
  // Открыт другой чат: реплика в открытом сразу стала бы прочитанной.
  await createChannel(page, "Другой");
  const folder = await project(page, "Объект");
  await page.request.post("/v1/conversations", { data: { title: "Внутри", projectId: folder } });
  await page.reload();
  await row(page, "Объект").click();

  // Чужая реплика в «Смете» — у неё число непрочитанного.
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  await guest.post(`/v1/conversations/${room}/messages`, {
    data: { body: "посмотри смету", clientMsgId: crypto.randomUUID() },
  });
  await guest.dispose();
  await expect(row(page, "Смета")).toContainText("1");

  // П-1: ни одной кнопки действий у строк.
  await row(page, "Смета").hover();
  await expect(page.getByRole("button", { name: /^Что сделать с/u })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Закрепить|Открепить|Удалить) канал/u }),
  ).toHaveCount(0);

  // П-2: правый край числа — у правого края строки, а не левее кнопок.
  const gap = await row(page, "Смета").evaluate((button) => {
    const line = button.parentElement?.getBoundingClientRect();
    // Значки — последний узел кнопки; внутри них подпись для читалки
    // стоит абсолютно в 1 px, и мерить её значило бы мерить не то.
    const badge = button.lastElementChild?.getBoundingClientRect();
    return line && badge ? Math.round(line.right - badge.right) : -1;
  });
  expect(gap, "число стоит не у края строки").toBeGreaterThanOrEqual(0);
  expect(gap, "число стоит не у края строки").toBeLessThanOrEqual(12);
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
  await expect(page.getByRole("menuitem", { name: "Удалить канал" })).toBeVisible();
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
  await expect(page.getByRole("menuitem", { name: "Удалить канал" })).toBeVisible();
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

  // Удалить: спрашивает подтверждение.
  await row(page, "Редкий").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Удалить канал" }).click();
  await expect(page.getByRole("dialog")).toContainText("Удалить «Редкий»?");
});

test("у проекта меню правой кнопкой и с клавиатуры", async ({ page }) => {
  await register(page, "Хозяин");
  await project(page, "Объект");
  await page.reload();

  await row(page, "Объект").click({ button: "right" });
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["Закрепить", "Редактировать проект", "Убрать проект"]);
  await page.keyboard.press("Escape");

  await row(page, "Объект").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Редактировать проект" })).toBeVisible();
});
