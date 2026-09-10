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

/** Наблюдаемый вид одного интерактивного поля, без привязки к его классам. */
async function controlStyle(locator: import("@playwright/test").Locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      height: style.height,
    };
  });
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

test("поля и раскрытый список ключа образуют одну визуальную систему", async ({ page }) => {
  // Системная тема намеренно не совпадает с темой приложения. Иначе чужой
  // `dark:` в Select остаётся скрытым и тест не воспроизводит снимок владельца.
  await page.emulateMedia({ colorScheme: "dark" });
  const { dialog, provider, key, scope, save } = await openKeyDialog(page);

  const [providerStyle, keyStyle, scopeStyle] = await Promise.all([
    controlStyle(provider),
    controlStyle(key),
    controlStyle(scope),
  ]);
  expect(providerStyle).toEqual(keyStyle);
  expect(scopeStyle).toEqual(keyStyle);

  const scopeBox = await scope.boundingBox();
  const saveBox = await save.boundingBox();
  expect(scopeBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  if (!scopeBox || !saveBox) throw new Error("Поля формы не имеют измеримой геометрии");
  expect(saveBox.y - (scopeBox.y + scopeBox.height)).toBeGreaterThanOrEqual(24);

  // После открытия Radix временно выводит триггер из дерева доступности,
  // пока фокус живёт в portal списка. Геометрию берём до открытия — это
  // тот же неподвижный узел, а локатор по роли после открытия уже не обязан
  // его находить.
  const triggerBox = await provider.boundingBox();
  await provider.click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();

  const listBox = await list.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(listBox).not.toBeNull();
  if (!triggerBox || !listBox) throw new Error("Список не имеет измеримой геометрии");
  expect(listBox.width).toBeGreaterThanOrEqual(triggerBox.width - 1);
  expect(listBox.y - (triggerBox.y + triggerBox.height)).toBeGreaterThanOrEqual(4);

  const listStyle = await list.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(listStyle.borderRadius).toBe(keyStyle.borderRadius);
  expect(listStyle.borderWidth).not.toBe("0px");
  expect(listStyle.boxShadow).not.toBe("none");

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
