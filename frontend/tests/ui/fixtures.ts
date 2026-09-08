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
 * Открыть меню реплики правой кнопкой и выбрать пункт.
 *
 * ⚠️ ЩЁЛКАЕМ ПО САМОМУ ТЕКСТУ, А НЕ ПО СТРОКЕ. Строка растянута во всю
 * ширину ленты (960 точек), пузырь — по длине текста (сотня). Playwright
 * бьёт в середину, и середина строки — пустое место СПРАВА от пузыря,
 * где меню не живёт. Измерено, а не угадано: на этом легли все три
 * первых прогона.
 */
export async function menu(page: Page, text: string, item: string): Promise<void> {
  await bubble(page, text).first().getByText(text).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: item, exact: true }).click();
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
  await typeInto(page, text, "Отправить");
  await expect(bubble(page, text).getByLabel("доставлено")).toBeVisible();
}

/** Сохранить правку: прежний текст стирается, кнопка называется иначе. */
export async function saveEdit(page: Page, text: string): Promise<void> {
  await typeInto(page, text, "Сохранить", { clear: true });
}

/**
 * Набрать в поле и нажать ввод.
 *
 * ⚠️ ЖДЁМ, ПОКА КНОПКА ОТПРАВКИ ОЖИВЁТ. Это не «подождать миллисекунду»,
 * а видимое человеку условие: пока поле пусто, кнопка выключена. Без
 * ожидания две трети прогонов теряли реплику — измерено отдельным
 * прогоном, 8 потерь из 12.
 *
 * Причина не в тесте: содержимое поля живёт в ДВУХ местах — в самом
 * редакторе и в копии, которую держит поле ввода. Отправка читает копию,
 * а копия обновляется не сразу. Кто вставит текст и мгновенно нажмёт
 * ввод — не отправит ничего (Д-21). Кнопка выключена ровно до того
 * мгновения, когда копия догнала, поэтому ждать её — значит ждать
 * готовности, а не выдуманного срока.
 */
export async function typeInto(
  page: Page,
  text: string,
  button: string,
  { clear = false }: { clear?: boolean } = {},
): Promise<void> {
  await field(page).click();

  // ⚠️ ВЫДЕЛЕНИЕ ВСЕГО — ТОЛЬКО ТАМ, ГДЕ ЕСТЬ ЧТО СТИРАТЬ. Ctrl+A на
  // ПУСТОМ поле съедает первую букву набранного: «видно» приезжало
  // «идно». Поймано только потому, что тест сверяет набранное с тем,
  // что в поле, — по значку «доставлено» это выглядело бы как
  // случайное мигание раз в три прогона.
  if (clear) {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(field(page)).toHaveText("");
  }

  // ⚠️ НАБИРАЕМ ПО ЗНАКУ, А НЕ ВСТАВЛЯЕМ ЦЕЛИКОМ. `fill` кладёт текст
  // одним куском мимо клавиатуры, и редактор его иногда не замечает
  // вовсе: замер на двадцати прогонах — вставка 6 из 10, набор 10 из 10.
  // Набор к тому же и есть то, что делает человек.
  await field(page).pressSequentially(text);

  // Сверяем, что в поле лежит ровно набранное. Без этой строки потеря
  // знака проявляется где-то дальше и выглядит как мигание теста.
  await expect(field(page)).toHaveText(text);
  await expect(page.getByLabel(button, { exact: true })).toBeEnabled();
  await field(page).press("Enter");
}
