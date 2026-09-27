import { register } from "./fixtures.js";
import { expect, test } from "./guard.js";

test("агенты оставляют две рабочие секции без вступительных пояснений", async ({ page }) => {
  await register(page, "Оператор");
  await page.goto("/settings/agents");

  await expect(page.getByRole("heading", { name: "Своя подписка" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ключ API" })).toBeVisible();
  await expect(page.getByText(/Нужен установленный клиент/u)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Подключить" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ключ", exact: true })).toBeVisible();
});

test("агенты живут в настройках, а старая ссылка ведёт туда же", async ({ page }) => {
  await register(page, "Оператор");

  await page.goto("/agents");
  await expect(page).toHaveURL(/\/settings\/agents$/);
  await expect(page.getByRole("link", { name: "Агенты" })).toBeVisible();
});

test("«Подключить» открывает окно со строкой запуска моста", async ({ page }) => {
  await register(page, "Подключение");
  await page.goto("/settings/agents");

  await page.getByRole("button", { name: "Подключить" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Строка запуска моста")).toBeVisible();
});

test("ошибка проверки живёт в окне подключения, а не раздвигает страницу", async ({ page }) => {
  await register(page, "Проверка");
  await page.goto("/settings/agents");

  await page.getByRole("button", { name: "Проверить" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Мост не на связи. Запустите строку выше в терминале и не закрывайте окно."),
  ).toBeVisible();
});

/**
 * Неверный ключ — причина словами (task-120). Форма ключа теперь проверяется
 * схемой двери, и отказ приходит полем `fields.key`, а не `detail`: человек
 * обязан увидеть то же «с чего начинается ключ», что и прежде.
 */
test("ключ не той формы — форма говорит, с чего он начинается", async ({ page }) => {
  await register(page, "Оператор");
  await page.goto("/settings/agents");

  await page.getByRole("textbox", { name: "Ключ", exact: true }).fill("просто текст");
  await page.getByRole("button", { name: "Сохранить ключ" }).click();

  await expect(page.getByText(/^ключ \w+ начинается с «sk-/u)).toBeVisible();
});
