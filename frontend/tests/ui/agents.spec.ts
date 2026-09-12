import { expect, test } from "@playwright/test";
import { register } from "./fixtures.js";

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

test("выдача кода открывается поверх неподвижной формы ключа", async ({ page }) => {
  await register(page, "Подключение");
  await page.goto("/settings/agents");

  // При открытом диалоге Radix правильно скрывает фон от чтения с экрана.
  // Геометрию фона поэтому измеряем по семантическому тегу, а не по роли:
  // иначе тест проверяет не сдвиг, а работу фокус-ловушки общего Dialog.
  const keyHeading = page.locator("h3").filter({ hasText: "Ключ API" });
  const before = await keyHeading.boundingBox();
  if (!before) throw new Error("заголовок ключа не измеряется");

  await page.getByRole("button", { name: "Подключить" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Строка запуска моста")).toBeVisible();
  const after = await keyHeading.boundingBox();
  expect(after?.y).toBe(before.y);
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

test("выбранный пункт тихого списка повторяет скругление поля", async ({ page }) => {
  await register(page, "Радиус");
  await page.goto("/settings/agents");

  const trigger = page.getByRole("combobox", { name: "Кому" });
  const radius = async (locator: typeof trigger) =>
    locator.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  // Поле меряем ДО раскрытия: открытый список прячет остальную страницу
  // от чтения экрана (aria-hidden), и по роли поле уже не найти.
  const fieldRadius = await radius(trigger);

  await trigger.click();
  const selected = page.getByRole("option", { name: "Только мой", exact: true });
  await expect(selected).toBeVisible();
  expect(await radius(selected)).toBe(fieldRadius);
});
