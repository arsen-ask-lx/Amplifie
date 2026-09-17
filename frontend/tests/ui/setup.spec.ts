import { expect, test } from "@playwright/test";
import { field, skipSetup } from "./fixtures.js";

/**
 * МАСТЕР ПЕРВОГО ЗАПУСКА (task-023).
 *
 * ⚠️ ЗДЕСЬ НЕ ИСПОЛЬЗУЕТСЯ ОБЩАЯ ПОДГОТОВКА `register`. Она проходит
 * мастер насквозь — то есть ровно то, что здесь проверяется. Взять её
 * значило бы проверять проверку.
 *
 * Чего здесь нет: подключения подписки и ключа. Первое требует запущенного
 * моста на машине, второе — настоящего ключа поставщика. Оба живут внутри
 * готовых кусков и проверены своими прогонами; мастер их только
 * рассаживает. Единственная проверка подключения — живой прогон руками
 * до настоящего ответа модели, и он назван арбитром в плане.
 *
 * Вопросы к тестам — dock/tasks/task-023-мастер-первого-запуска.md §6.
 * Перед запуском: make up
 */

let counter = 0;

function newPerson() {
  counter += 1;
  const mark = `${Date.now()}-${counter}`;
  return {
    email: `setup-${mark}@example.test`,
    password: "очень-длинный-пароль-для-теста",
    name: `Устанавливающий ${counter}`,
  };
}

async function install(page: import("@playwright/test").Page) {
  const person = newPerson();
  await page.goto("/");

  // На этом стенде регистрация открыта всегда, и дверь сразу установочная.
  const toSetup = page.getByRole("button", { name: "Создать новое пространство" });
  await expect(page.getByRole("button", { name: /Войти|Создать/u })).toBeVisible();
  if (await toSetup.isVisible()) await toSetup.click();

  await page.getByLabel("Почта").fill(person.email);
  await page.getByLabel("Пароль").fill(person.password);
  await page.getByLabel("Как вас зовут").fill(person.name);
  await page.getByLabel("Название пространства").fill(`Пространство ${person.name}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  return person;
}

async function openKeyDialog(page: import("@playwright/test").Page) {
  await install(page);
  await page.getByRole("button", { name: /Ключ API/u }).click();

  const dialog = page.getByRole("dialog", { name: "Ключ API" });
  await expect(dialog).toBeVisible();

  return {
    dialog,
    provider: dialog.getByRole("combobox", { name: "Поставщик" }),
    key: dialog.getByLabel("Ключ"),
    scope: dialog.getByRole("combobox", { name: "Кому" }),
    save: dialog.getByRole("button", { name: "Сохранить ключ" }),
  };
}

test("после установки открывается подключение модели, а не пустой чат", async ({ page }) => {
  await install(page);

  // Главное утверждение задачи: человек не остаётся один на один
  // с пустым каналом, где всё непонятно.
  await expect(page.getByRole("heading", { name: "Подключение модели" })).toBeVisible();

  // Продукта под мастером нет вовсе — иначе это подсказка, а не установка.
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeHidden();
});

test("предлагаются оба способа, и у каждого названо условие", async ({ page }) => {
  await install(page);

  await expect(page.getByRole("button", { name: /Своя подписка/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ключ API/u })).toBeVisible();

  // Подписка бесплатна, но требует включённой машины; про это сказано
  // на экране, а не в документации, — иначе человек узнает об этом
  // в тот вечер, когда закроет ноутбук.
  await expect(page.getByText(/пока компьютер включён/u)).toBeVisible();
});

test("пропустивший подключение оказывается в рабочем чате", async ({ page }) => {
  await install(page);
  await skipSetup(page);

  // Не «нет ошибки», а работающий продукт: канал на месте и в него
  // можно говорить.
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
  await expect(field(page)).toBeVisible();
});

test("«Своя подписка» открывает одно окно, а не два", async ({ page }) => {
  await install(page);
  await page.getByRole("button", { name: /Своя подписка/u }).click();

  // Ждём то, ради чего окно открывали: код подключения моста либо честный
  // отказ выдачи. Без ожидания проверка числа окон успела бы до второго.
  await expect(
    page
      .getByRole("button", { name: "Копировать строку запуска" })
      .or(page.getByText(/Не удалось выдать код/u)),
  ).toBeVisible();

  /**
   * ⚠️ ОДНО ОКНО, А НЕ ДВА (владелец 17.09: «нахрена там 2 окна»). Панель
   * внутри окна открывала своё второе поверх первого.
   *
   * ⚠️ СЧИТАЕМ УЗЛЫ, А НЕ РОЛИ, И ЭТО НЕ ПРИДИРКА К РАЗМЕТКЕ. Radix помечает
   * нижнее окно `aria-hidden`, поэтому поиск по роли видит ровно одно окно
   * даже тогда, когда их два: первая редакция этой проверки была зелёной
   * на сломанном экране. Человек видит две рамы — их и считаем.
   */
  await expect(page.locator('[role="dialog"]'), "окно поверх окна").toHaveCount(1);
});

test("поставщик выбирается с клавиатуры, Escape закрывает список, затем окно", async ({ page }) => {
  const { dialog, provider } = await openKeyDialog(page);

  await provider.click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();

  await list.getByRole("option", { name: "Anthropic (Claude)" }).press("ArrowDown");
  await list.getByRole("option", { name: "OpenAI" }).press("Enter");
  await expect(provider).toContainText("OpenAI");

  await provider.click();
  await expect(list).toBeVisible();
  await list.getByRole("option", { name: "OpenAI" }).press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();
  await provider.press("Escape");
  await expect(dialog).toBeHidden();
});

test("окно ключа помещается в узкий экран с полями и действием", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, provider, key, scope, save } = await openKeyDialog(page);

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Модальное окно не имеет измеримой геометрии");
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(390 - (box.x + box.width)).toBeGreaterThanOrEqual(16);

  await expect(provider).toBeVisible();
  await expect(key).toBeVisible();
  await expect(scope).toBeVisible();
  await expect(save).toBeVisible();
});
