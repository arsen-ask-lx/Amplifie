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

let счётчик = 0;

function newPerson() {
  счётчик += 1;
  const mark = `${Date.now()}-${счётчик}`;
  return {
    email: `setup-${mark}@example.test`,
    password: "очень-длинный-пароль-для-теста",
    name: `Устанавливающий ${счётчик}`,
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

test("после установки открывается подключение модели, а не пустой чат", async ({ page }) => {
  await install(page);

  // Главное утверждение задачи: человек не остаётся один на один
  // с пустым каналом, где всё непонятно.
  await expect(page.getByRole("heading", { name: "Подключение модели" })).toBeVisible();

  // Продукта под мастером нет вовсе — иначе это подсказка, а не установка.
  await expect(page.getByRole("button", { name: "Новый канал" })).toBeHidden();
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
  await expect(page.getByRole("button", { name: "Новый канал" })).toBeVisible();
  await expect(field(page)).toBeVisible();
});
