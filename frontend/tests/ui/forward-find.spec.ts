import { createChannel, field, menu, register, say } from "./fixtures.js";
import { expect, type Page, test } from "./guard.js";

/**
 * «ПЕРЕСЛАТЬ» ИЩЕТ ЧАТ (task-117, П-7, П-8).
 *
 * Прежде окно брало весь список пространства одним ответом (Д-41), поля
 * поиска не было, а отказ загрузки молча проглатывался. Теперь пустое поле
 * показывает чаты панели, набор ищет по всем видимым — и чат из свёрнутой
 * папки находится.
 *
 * ⚠️ СВЕРЯЕМ, КУДА УШЛА РЕПЛИКА, ЗАПРОСОМ, А НЕ ГЛАЗОМ. Пересылка в чужой
 * чат выглядит на экране так же, как верная: окно закрылось, и всё.
 */

test.describe.configure({ timeout: 120_000 });

/** Завести папку и чат в ней запросами: здесь проверяется окно, а не заводка. */
async function chatInFolder(page: Page, folder: string, title: string): Promise<string> {
  return page.evaluate(
    async ([name, chat]) => {
      const post = (path: string, body: object) =>
        fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((response) => response.json() as Promise<{ id: string }>);
      const project = await post("/v1/projects", { title: name });
      return (await post("/v1/conversations", { title: chat, projectId: project.id })).id;
    },
    [folder, title] as const,
  );
}

/** Тексты реплик чата — с сервера. */
async function bodiesIn(page: Page, conversationId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/v1/conversations/${id}/messages`, { credentials: "include" });
    const page = (await response.json()) as { items: { body: string }[] };
    return page.items.map((one) => one.body);
  }, conversationId);
}

/** Номер чата по названию — через поиск той же двери, что у окна. */
async function chatId(page: Page, title: string): Promise<string> {
  return page.evaluate(async (name) => {
    const response = await fetch("/v1/search/chats", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: name }),
    });
    const found = (await response.json()) as { items: { id: string; title: string }[] };
    const hit = found.items.find((one) => one.title === name);
    if (!hit) throw new Error(`чат «${name}» не найден`);
    return hit.id;
  }, title);
}

function picker(page: Page) {
  return page.getByRole("dialog", { name: "Переслать" });
}

test("чат в свёрнутой папке находится набором; Enter пересылает, курсор — в поле ввода", async ({
  page,
}) => {
  await register(page, "Пересылающий");
  const hidden = await chatInFolder(page, "Архив", "Смета клиента");
  await createChannel(page, "Откуда");
  await say(page, "реплика для сметы");
  // Свернуть папку и перезагрузить: свёрнутую папку панель не загружает,
  // и чата «Смета клиента» вкладка не знает вовсе.
  const folder = page.getByRole("button", { name: /^Архив/u });
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Архив/u })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await menu(page, "реплика для сметы", "Переслать");
  await expect(picker(page)).toBeVisible();
  // Пустое поле — только то, что знает панель: этого чата там нет.
  await expect(picker(page).getByRole("option", { name: "Откуда" })).toBeVisible();
  await expect(picker(page).getByRole("option", { name: "Смета клиента" })).toHaveCount(0);
  await page.keyboard.type("смета кл", { delay: 20 });
  await expect(picker(page).getByRole("option", { name: "Смета клиента" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => bodiesIn(page, hidden)).toContain("реплика для сметы");
  await expect(field(page)).toBeFocused();
});

test("Enter сразу после набора, до ответа сервера, — только в чат с набранным в названии", async ({
  page,
}) => {
  await register(page, "Торопливый");
  await createChannel(page, "Смета быстрая");
  await createChannel(page, "Откуда");
  await say(page, "реплика без ожидания");
  const wanted = await chatId(page, "Смета быстрая");
  const source = await chatId(page, "Откуда");

  // Сервер поиска отвечает не сразу: Enter нажат, пока ответа нет.
  await page.route("**/v1/search/chats", async (route) => {
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue();
  });

  await menu(page, "реплика без ожидания", "Переслать");
  await page.keyboard.type("смета", { delay: 10 });
  await page.keyboard.press("Enter");

  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => bodiesIn(page, wanted)).toContain("реплика без ожидания");
  // В исходный чат пересылки нет: там одна реплика — сама исходная.
  expect(
    (await bodiesIn(page, source)).filter((one) => one === "реплика без ожидания"),
  ).toHaveLength(1);
});

test("сервер поиска отказал — окно говорит об этом, чаты панели остаются", async ({ page }) => {
  await register(page, "Без поиска");
  await createChannel(page, "Смета запасная");
  await createChannel(page, "Откуда");
  await say(page, "реплика при отказе");
  const spare = await chatId(page, "Смета запасная");

  await page.route("**/v1/search/chats", (route) => route.fulfill({ status: 500, body: "{}" }));

  await menu(page, "реплика при отказе", "Переслать");
  await page.keyboard.type("смета", { delay: 10 });
  await expect(picker(page).getByText("Не удалось найти чаты")).toBeVisible();
  await expect(picker(page).getByRole("button", { name: "Повторить" })).toBeVisible();

  await picker(page).getByRole("option", { name: "Смета запасная" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => bodiesIn(page, spare)).toContain("реплика при отказе");
});
