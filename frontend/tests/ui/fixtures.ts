import { expect, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

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
let counter = 0;

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
  const mark = `${Date.now()}-${counter}`;
  return {
    name: `${role} ${counter}`,
    email: `ui-${mark}@example.test`,
    password: "очень-длинный-пароль-для-теста",
  };
}

function counterUp() {
  counter += 1;
}

/**
 * Встать на нужную дверь (task-023).
 *
 * ⚠️ ДВЕРЬ ТЕПЕРЬ ВЫБИРАЕТ СЕРВЕР, А НЕ ЭКРАН. На этом стенде
 * `AMPLIFIE_MULTI_WORKSPACE=true`, поэтому регистрация всегда открыта
 * и первой показывается УСТАНОВКА, а не вход. На коробке будет наоборот
 * — и подготовка обязана работать в обоих случаях, иначе прогоны
 * привязаны к настройке стенда, а не к продукту.
 */
async function door(page: Page, want: "установка" | "вход"): Promise<void> {
  const need = page.getByRole("button", {
    name: want === "установка" ? "Создать новое пространство" : "У меня уже есть вход",
  });
  // Ждём, пока экран определится: до ответа сервера формы нет вовсе.
  await expect(page.getByRole("button", { name: /Войти|Создать/u })).toBeVisible();
  if (await need.isVisible()) await need.click();
}

/** Пройти установку насквозь, ничего не подключая. Экран один (task-026). */
export async function skipSetup(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Подключить позже" }).click();
}

/** Завести пространство и войти в него. Возвращает, кто вошёл. */
export async function register(page: Page, role = "Проверяющий"): Promise<Person> {
  const person = newPerson(role);
  await page.goto("/");
  await door(page, "установка");

  await page.getByLabel("Почта").fill(person.email);
  await page.getByLabel("Пароль").fill(person.password);
  await page.getByLabel("Как вас зовут").fill(person.name);
  await page.getByLabel("Название пространства").fill(`Пространство ${person.name}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  // ⚠️ ПОСЛЕ УСТАНОВКИ ИДЁТ МАСТЕР, А НЕ ЧАТ (task-023). Подготовка
  // проходит его насквозь «пропустить»: здесь проверяют не установку,
  // а то, что за ней. Сам мастер проверяет `setup.spec.ts`.
  await skipSetup(page);

  // Ждём не «нет ошибки», а появления рабочего экрана: отсутствие ошибки
  // наступает и тогда, когда не произошло ничего.
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
  return person;
}

/** Войти существующим человеком — для второй вкладки того же человека. */
export async function login(page: Page, person: Person): Promise<void> {
  await page.goto("/");
  await door(page, "вход");
  await page.getByLabel("Почта").fill(person.email);
  await page.getByLabel("Пароль").fill(person.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
}

/**
 * Позвать второго человека по ссылке и войти им.
 *
 * ⚠️ ВТОРАЯ ВКЛАДКА — ЭТО НЕ ВТОРОЙ ЧЕЛОВЕК, и для непрочитанного разница
 * решающая: свои реплики не считаются, значит проверять счётчик двумя
 * вкладками одного человека нельзя вовсе. Ссылка-приглашение —
 * единственный вход второго (Р-009), поэтому идём через неё.
 *
 * `хозяин` — вкладка того, кто зовёт; `гость` — чистая вкладка новичка.
 */
export async function invited(guest: Page, owner: Page, name: string): Promise<void> {
  await owner.getByLabel("Профиль и настройки").click();
  await owner.getByRole("menuitem", { name: "Пригласить в пространство" }).click();

  const linkField = owner.getByLabel("Ссылка-приглашение");
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  await owner.getByRole("button", { name: "Закрыть" }).click();

  counterUp();
  await guest.goto(link);
  await guest.getByLabel("Почта").fill(`ui-guest-${Date.now()}-${counter}@example.test`);
  await guest.getByLabel("Пароль").fill("очень-длинный-пароль-для-теста");
  await guest.getByLabel("Как вас зовут").fill(name);
  await guest.getByRole("button", { name: "Войти" }).click();
  await expect(guest.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
}

/**
 * Завести чат и открыть его.
 *
 * ⚠️ БЕЗ ПАПКИ, И ЭТО ОБЫЧНЫЙ СЛУЧАЙ (task-037). Чат заводится главной
 * кнопкой панели и лежит простым списком сверху; в папке он рождается
 * тогда, когда человек нажал «Новый чат» ВНУТРИ неё.
 *
 * ⚠️ ТОЧНОЕ СОВПАДЕНИЕ ИМЕНИ: у кнопки внутри папки имя длиннее —
 * «Новый чат в проекте «Объект»», — и без `exact` подошли бы обе.
 */
export async function createChannel(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await page.getByLabel("Название нового чата").fill(title);
  await page.getByLabel("Название нового чата").press("Enter");
  await openChannel(page, title);
}

/** Открыть канал по названию в боковой панели. */
export async function openChannel(page: Page, title: string): Promise<void> {
  // ⚠️ ПО НАЧАЛУ ИМЕНИ, А НЕ ЦЕЛИКОМ. У канала с непрочитанным доступное
  // имя кнопки длиннее названия: в него входит число со словом для чтения
  // с экрана (task-024). Точное совпадение перестало бы открывать ровно
  // те каналы, куда человек и идёт.
  const row = page.getByRole("button", { name: new RegExp(`^${title}`) });
  await row.click();

  /**
   * ⚠️ ЖДЁМ, ЧТО КАНАЛ СТАЛ ОТКРЫТЫМ, А НЕ ЧТО ВИДНО ПОЛЕ ВВОДА.
   *
   * Поле ввода видно в ЛЮБОМ канале, поэтому прежнее ожидание не
   * доказывало ничего: нажатие могло не сработать, а проверка ехала
   * дальше. Ловилось это редко и выглядело как поломка продукта —
   * «реплики чужого канала просвечивают»: тест смотрел ленту канала,
   * который так и не открылся.
   *
   * Список каналов при этом ПЕРЕСТРАИВАЕТСЯ по свежести: сказал реплику —
   * канал уехал наверх. Нажатие, пришедшееся на этот миг, достаётся
   * соседней строке.
   *
   * `aria-current="page"` — тот самый признак «этот канал открыт»,
   * который видит и человек, и программа чтения экрана.
   */
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(field(page)).toBeVisible();
}

/**
 * Открыть меню строки панели правой кнопкой (task-102).
 *
 * ⚠️ ТРЁХ ТОЧЕК У СТРОК БОЛЬШЕ НЕТ: действия чата и проекта живут в меню
 * по правой кнопке. Строка ищется по началу имени — у канала с непрочитанным
 * доступное имя длиннее названия (см. `openChannel`).
 */
export async function rowMenu(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${title}`, "u") }).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Поле ввода реплики. */
export function field(page: Page) {
  return page.getByLabel("Текст сообщения");
}

/**
 * Дождаться, пока доедет наш шрифт.
 *
 * ⚠️ БЕЗ ЭТОГО ГЕОМЕТРИЯ МИГАЕТ, И МИГАЕТ РЕДКО — то есть худшим
 * способом. Geist подключается своим файлом с `font-display: swap`:
 * пока он едет, текст рисуется системным шрифтом, а у системного другая
 * ширина знака. Сценарий, меряющий просвет между словом и временем или
 * ширину страницы, на свободной машине успевает померить уже готовое,
 * а под нагрузкой — ещё системное. Оба раза он «прав», и оба раза числа
 * разные.
 *
 * Ждём событие браузера, а не миллисекунды: сон лечит симптом и врёт
 * на медленной машине ровно так же.
 */
export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
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

/**
 * Сама область прокрутки ленты.
 *
 * ⚠️ ПОЯВЛЯЕТСЯ ТОЛЬКО С ПЕРВОЙ РЕПЛИКОЙ: у пустого канала на её месте
 * приглашение написать, и `role="log"` не существует.
 */
export function feedBox(page: Page) {
  return page.getByRole("log");
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

/** Удалить реплику так, как это делает человек: меню и подтверждение (task-061). */
export async function removeMessage(page: Page, text: string): Promise<void> {
  await menu(page, text, "Удалить");
  await page.getByRole("dialog").getByRole("button", { name: "Удалить", exact: true }).click();
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
  /**
   * ⚠️ С ЗАДЕРЖКОЙ МЕЖДУ ЗНАКАМИ, И ЭТО НЕ «ПОДОЖДАТЬ НА ВСЯКИЙ СЛУЧАЙ».
   * Без неё Playwright сыплет знаки быстрее, чем редактор успевает
   * закончить предыдущее обновление, и после очистки поля первая буква
   * иногда пропадала: «смета» приезжала как «мета». Ловилось редко
   * и выглядело как поломка правки реплики.
   *
   * 15 мс — примерно вдвое быстрее очень быстрой машинистки (120 слов
   * в минуту это около 100 мс на знак). То есть мы всё ещё торопливее
   * человека, но уже в человеческом порядке величин, а не в двадцать раз
   * быстрее. Проверять надо продукт, а не выносливость редактора
   * под пулемётным вводом.
   */
  await field(page).pressSequentially(text, { delay: 15 });

  // Сверяем, что в поле лежит ровно набранное. Без этой строки потеря
  // знака проявляется где-то дальше и выглядит как мигание теста.
  await expect(field(page)).toHaveText(text);
  await expect(page.getByLabel(button, { exact: true })).toBeEnabled();
  await field(page).press("Enter");
}

/* ── посев истории (перенесён из window.spec.ts, task-099) ───────────── */

/** Адрес стенда — тот же, что у самой проверки. */
const BASE = process.env.UI_URL ?? "http://localhost:8477";

/** Сколько говорит один голос. Ниже порога в тридцать, с запасом. */
const PER_REQUEST = 25;

/**
 * Насеять историю: много людей по многу реплик.
 *
 * ⚠️ РАНЬШЕ СЕЯЛ ОДИН ЧЕЛОВЕК, И ЭТО БЫЛО НЕПРАВДОЙ. Порог отправки —
 * тридцать реплик в минуту на человека (Р-025), потому что быстрее
 * человек не печатает. Посев в триста шестьдесят строк от одного имени
 * упёрся в него, как и должен был: столько за минуту не говорят.
 *
 * Оживлённый канал оживлён не потому, что кто-то один строчит, а потому
 * что людей много. Поэтому и здесь их много: владелец зовёт одной ссылкой,
 * каждый вошедший говорит своё. Заодно это первый посев, который стал
 * возможен только после появления приглашений.
 *
 * Через `request`, а не через браузер: двенадцать вкладок ради двенадцати
 * голосов — это минуты прогона за то, что проверяется одним запросом.
 * У каждого своя корзинка печенек, значит и свой счётчик.
 */
export type Requests = PlaywrightWorkerArgs["playwright"]["request"];

/** Ссылка-приглашение от имени владельца: одна на весь посев. */
export async function inviteToken(page: Page): Promise<string> {
  const made = await page.evaluate(async () => {
    const response = await fetch("/v1/invites", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxUses: 100 }),
    });
    return (await response.json()) as { token: string };
  });
  return made.token;
}

/**
 * Второй человек пространства без браузера: вошёл по ссылке, говорит
 * запросами. Своя корзинка печенек — свой порог отправки.
 */
export async function joinVoice(
  requests: Requests,
  token: string,
  name: string,
): Promise<Awaited<ReturnType<Requests["newContext"]>>> {
  counterUp();
  const guest = await requests.newContext({ baseURL: BASE });
  const entered = await guest.post("/v1/auth/join", {
    data: {
      token,
      email: `seed-${Date.now()}-${counter}@example.test`,
      password: "очень-длинный-пароль-для-теста",
      displayName: name,
    },
  });
  if (!entered.ok()) throw new Error(`вход по ссылке не удался (${entered.status()})`);
  return guest;
}

/**
 * Один голос: вошёл по ссылке и сказал сколько-то строк.
 *
 * ⚠️ ПО ЗАПАСУ ДО ПОРОГА, А НЕ ВПРИТЫК. Порог — тридцать в минуту;
 * попадать в него ровно значит однажды промахнуться на единицу
 * и краснеть без причины.
 */
async function oneVoice(
  requests: Requests,
  room: string,
  token: string,
  from: number,
  count: number,
): Promise<void> {
  const guest = await joinVoice(requests, token, `Голос ${from}`);

  // ⚠️ ПАЧКАМИ, А НЕ ВСЕ РАЗОМ И НЕ ПО ОЧЕРЕДИ. Триста шестьдесят запросов
  // друг за другом не укладывались в срок проверки. Все двадцать пять разом
  // на каждый голос рвали соединения на ~425-й реплике (task-099): каждый
  // одновременный запрос — новое соединение, и проброс порта Docker
  // на Windows захлёбывался. Порт после этого отказывал и следующему
  // сценарию. Замер пробой: пачки по пять — 600 реплик дважды подряд
  // за 30 с без единого обрыва. Один голос говорит меньше, чем ему
  // позволено в минуту (25 из 30), поэтому порог отправки это не задевает.
  for (let n = 0; n < count; n += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, count - n) }, (_, k) => {
      const index = from + n + k;
      // ⚠️ ПЕРВАЯ — С ОСОБЫМ ТЕКСТОМ. Искать «строка номер 1» нельзя:
      // то же вхождение есть у десятой, сотой и ещё сотни других,
      // и проверка «осталась одна» насчитала сто одиннадцать.
      const body = index === 1 ? "самая первая строка" : `строка номер ${index}`;
      return guest.post(`/v1/conversations/${room}/messages`, {
        data: { body, clientMsgId: crypto.randomUUID() },
      });
    });
    const answers = await Promise.all(batch).catch((error: unknown) => {
      throw new Error(`посев: голос ${from} оборвался на отправке — ${String(error)}`);
    });
    for (const said of answers) {
      if (!said.ok()) throw new Error(`посев: реплика не ушла (${said.status()})`);
    }
  }
  await guest.dispose();
}

/** Сколько реплик голоса уходит одновременно — см. `oneVoice`. */
const BATCH = 5;

export async function seedHistory(page: Page, requests: Requests, count: number): Promise<void> {
  const room = new URL(page.url()).pathname.split("/").pop();
  if (!room) throw new Error("не понял, какой канал открыт");

  const token = await inviteToken(page);
  for (let sent = 0; sent < count; sent += PER_REQUEST) {
    await oneVoice(requests, room, token, sent + 1, Math.min(PER_REQUEST, count - sent));
  }

  await page.reload();
  await expect(bubbles(page).first()).toBeVisible();
}
