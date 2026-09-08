import { expect, type Page } from "@playwright/test";

/**
 * Общая подготовка для проверок интерфейса: завести человека, канал,
 * сказать реплику.
 *
 * ⚠️ ВСЁ ЧЕРЕЗ ЭКРАН, А НЕ ЧЕРЕЗ HTTP. Быстрее было бы завести человека
 * запросом и подложить печеньку — и тогда вход перестал бы проверяться
 * вовсе. Он и так уже ломался у нас молча (см. кириллица в адресе почты).
 * Экран — то, чем пользуется человек; подготовка через него заодно
 * стережёт вход, не тратя на это отдельного теста.
 *
 * ⚠️ ЛОКАТОРЫ ТОЛЬКО ПО ВИДИМОМУ: роль, надпись, `aria-label` (Р-022 §3).
 * Ни одного селектора по классу: класс — это разметка, а разметка меняется
 * от вида, и тест, привязанный к ней, краснеет на исправном коде.
 */

/** У каждого прогона свой человек: общего состояния между сценариями нет. */
let счётчик = 0;

export interface Person {
  name: string;
  email: string;
  password: string;
}

/**
 * ⚠️ АДРЕС ПОЧТЫ ТОЛЬКО ЛАТИНИЦЕЙ. Кириллица в местной части даёт 422:
 * на этом молча упали семь приёмочных бека и полдня ушло на поиск.
 * Имя человека — по-русски, оно ничему не мешает.
 */
function newPerson(role: string): Person {
  counterUp();
  const mark = `${Date.now()}-${счётчик}`;
  return {
    name: `${role} ${счётчик}`,
    email: `ui-${mark}@example.test`,
    password: "очень-длинный-пароль-для-теста",
  };
}

function counterUp() {
  счётчик += 1;
}

/** Завести пространство и войти в него. Возвращает, кто вошёл. */
export async function register(page: Page, role = "Проверяющий"): Promise<Person> {
  const person = newPerson(role);
  await page.goto("/");
  await page.getByRole("button", { name: "Создать новое пространство" }).click();

  await page.getByLabel("Почта").fill(person.email);
  await page.getByLabel("Пароль").fill(person.password);
  await page.getByLabel("Как вас зовут").fill(person.name);
  await page.getByLabel("Название пространства").fill(`Пространство ${person.name}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  // Ждём не «нет ошибки», а появления рабочего экрана: отсутствие ошибки
  // наступает и тогда, когда не произошло ничего.
  await expect(page.getByRole("button", { name: "Новый канал" })).toBeVisible();
  return person;
}

/** Войти существующим человеком — для второй вкладки того же человека. */
export async function login(page: Page, person: Person): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Почта").fill(person.email);
  await page.getByLabel("Пароль").fill(person.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("button", { name: "Новый канал" })).toBeVisible();
}

/** Завести канал и открыть его. */
export async function createChannel(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новый канал" }).click();
  await page.getByLabel("Название нового канала").fill(title);
  await page.getByLabel("Название нового канала").press("Enter");
  await openChannel(page, title);
}

/** Открыть канал по названию в боковой панели. */
export async function openChannel(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(field(page)).toBeVisible();
}

/** Поле ввода реплики. */
export function field(page: Page) {
  return page.getByLabel("Текст сообщения");
}

/**
 * Все реплики на экране.
 *
 * ⚠️ НЕ ЧЕРЕЗ `role="log"`. У пустого канала ленты нет вовсе: на её месте
 * стоит приглашение написать первое сообщение, и `role="log"` появляется
 * только вместе с первой репликой. Тест, ждавший ленту в пустом канале,
 * ждал бы её до предела времени.
 */
export function bubbles(page: Page) {
  return page.locator("article");
}

/** Одна реплика по её тексту. */
export function bubble(page: Page, text: string) {
  return page.locator("article").filter({ hasText: text });
}

/**
 * Сказать реплику и дождаться, что она ДОШЛА ДО СЕРВЕРА.
 *
 * ⚠️ ЖДЁМ ЗНАЧОК «ДОСТАВЛЕНО», А НЕ ПОЯВЛЕНИЕ ТЕКСТА. Текст появляется
 * мгновенно — это черновик, живущий только в этой вкладке. Всё, что
 * проверяется дальше (правка, удаление, вторая вкладка), требует, чтобы
 * реплика существовала на сервере. Без этого ожидания тесты мигали бы,
 * и мигали бы по-настоящему редко — худший вид.
 */
export async function say(page: Page, text: string): Promise<void> {
  await field(page).fill(text);
  await field(page).press("Enter");
  await expect(bubble(page, text).getByLabel("доставлено")).toBeVisible();
}
