import { expect, type Page, type PlaywrightWorkerArgs, test } from "@playwright/test";
import { bubbles, createChannel, feedBox, login, openChannel, register, say } from "./fixtures.js";

/**
 * ОКНО ЛЕНТЫ (task-016, Р-023): старое вытесняется — но только у того,
 * кто внизу.
 *
 * ⚠️ ИСТОРИЯ СЕЯТСЯ ЗАПРОСАМИ, А НЕ НАБОРОМ. Триста шестьдесят реплик
 * руками — это восемь минут прогона вместо девяти секунд, и проверяли бы
 * они отправку, которую уже проверяет П-1. Здесь проверяется другое:
 * что делает лента, когда реплик много. Всё остальное — через экран.
 */

/** Сколько реплик держит лента. Должно совпадать с `ОКНО` в `useChat`. */
const WINDOW_SIZE = 300;

/** Заметно больше окна: иначе вытеснению нечего вытеснять. */
const SEEDED = 360;

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
type Requests = PlaywrightWorkerArgs["playwright"]["request"];

/** Ссылка-приглашение от имени владельца: одна на весь посев. */
async function inviteToken(page: Page): Promise<string> {
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
  const guest = await requests.newContext({ baseURL: BASE });
  const entered = await guest.post("/v1/auth/join", {
    data: {
      token,
      email: `seed-${Date.now()}-${from}@example.test`,
      password: "очень-длинный-пароль-для-теста",
      displayName: `Голос ${from}`,
    },
  });
  if (!entered.ok()) throw new Error(`посев: вход не удался (${entered.status()})`);

  // ⚠️ РАЗОМ, А НЕ ПО ОЧЕРЕДИ. Триста шестьдесят запросов друг за другом
  // не укладывались в срок проверки: сценарий падал на тридцатой секунде
  // не от поломки, а от собственной медлительности — худший вид красного.
  // Один голос говорит меньше, чем ему позволено в минуту (25 из 30),
  // поэтому порог отправки это не задевает.
  const posts = Array.from({ length: count }, (_, n) => {
    const index = from + n;
    // ⚠️ ПЕРВАЯ — С ОСОБЫМ ТЕКСТОМ. Искать «строка номер 1» нельзя:
    // то же вхождение есть у десятой, сотой и ещё сотни других,
    // и проверка «осталась одна» насчитала сто одиннадцать.
    const body = index === 1 ? "самая первая строка" : `строка номер ${index}`;
    return guest.post(`/v1/conversations/${room}/messages`, {
      data: { body, clientMsgId: crypto.randomUUID() },
    });
  });
  for (const said of await Promise.all(posts)) {
    if (!said.ok()) throw new Error(`посев: реплика не ушла (${said.status()})`);
  }
  await guest.dispose();
}

async function seed(page: Page, requests: Requests, count: number): Promise<void> {
  const room = new URL(page.url()).pathname.split("/").pop();
  if (!room) throw new Error("не понял, какой канал открыт");

  const token = await inviteToken(page);
  for (let sent = 0; sent < count; sent += PER_REQUEST) {
    await oneVoice(requests, room, token, sent + 1, Math.min(PER_REQUEST, count - sent));
  }

  await page.reload();
  await expect(bubbles(page).first()).toBeVisible();
}

/**
 * Долистать до самого верха: старое грузится страницами по мере подхода.
 *
 * ⚠️ ЖДЁМ ИЗВЕСТНОЕ ЧИСЛО, А НЕ «ПОКА ПЕРЕСТАНЕТ РАСТИ». Мы сами посеяли
 * историю и знаем её длину. «Перестало расти» пришлось бы отличать
 * от «ещё не приехало», а это ожидание срока под другим именем.
 */
async function toTheTop(page: Page, total: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await feedBox(page).evaluate((node) => {
          node.scrollTop = 0;
        });
        return bubbles(page).count();
      },
      { timeout: 30_000, intervals: [300] },
    )
    .toBe(total);
}

/** Лента доехала до конца: низ содержимого совпал с низом видимой части. */
async function atTheBottom(page: Page): Promise<boolean> {
  return feedBox(page).evaluate(
    (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 4,
  );
}

/**
 * ⚠️ СРОК БОЛЬШЕ ОБЫЧНОГО, И ЭТО ОБЪЯВЛЕНО, А НЕ ПОДКРУЧЕНО. Сценарий
 * сеет триста шестьдесят реплик от полутора десятков людей, потом
 * долистывает их до самого верха — это честные полминуты работы, а не
 * ожидание чего-то. В общий срок в тридцать секунд он не укладывался
 * и падал не от поломки, а от собственной длины; такой красный не значит
 * ничего и приучает перезапускать прогон.
 */
test.describe.configure({ timeout: 120_000 });

test("листающий назад ничего не теряет, а вернувшийся вниз получает окно", async ({
  page,
  browser,
  playwright,
}) => {
  const person = await register(page);
  await createChannel(page, "Много");
  await seed(page, playwright.request, SEEDED);

  // Начальная загрузка отдаёт одну страницу: полное окно лента набирает
  // только листанием назад. Это само по себе стоит проверить.
  expect(await bubbles(page).count()).toBeLessThan(WINDOW_SIZE);
  await toTheTop(page, SEEDED);

  // Человек стоит наверху и читает самое старое.
  const oldest = "самая первая строка";
  await expect(bubbles(page).filter({ hasText: oldest })).toHaveCount(1);

  // Вторая вкладка говорит что-то новое.
  const secondContext = await browser.newContext();
  const otherPage = await secondContext.newPage();
  await login(otherPage, person);
  await openChannel(otherPage, "Много");
  await say(otherPage, "свежая реплика сверху не режет");

  await expect(bubbles(page).filter({ hasText: "свежая реплика" })).toHaveCount(1);
  await expect(
    bubbles(page).filter({ hasText: oldest }),
    "у листающего назад вытеснили то, что он читает",
  ).toHaveCount(1);

  // А теперь он вернулся вниз — и следующая же реплика включает окно.
  //
  // ⚠️ ЖДЁМ САМУ ЛЕНТУ, А НЕ КНОПКУ «В КОНЕЦ».
  //
  // Сначала ждал исчезновения кнопки — и получил мигание раз в восемь
  // прогонов. Кнопка пропадает СРАЗУ по нажатию (лента уже считает себя
  // внизу), а прокрутка плавная и едет ещё секунду; на середине пути
  // кнопка появляется снова, и реплика из второй вкладки успевала
  // прийти, пока человек «не внизу». Окно правильно не включалось,
  // и выглядело это как поломка окна.
  //
  // Настоящее условие — «лента доехала», и оно измеримо: низ содержимого
  // совпал с низом видимой части.
  await page.getByLabel("В конец ленты").click();
  await expect.poll(() => atTheBottom(page), { timeout: 10_000 }).toBe(true);
  await say(otherPage, "вторая свежая реплика");
  await expect(bubbles(page).filter({ hasText: "вторая свежая" })).toHaveCount(1);

  await expect
    .poll(() => bubbles(page).count(), { timeout: 5_000 })
    .toBeLessThanOrEqual(WINDOW_SIZE);
  await expect(
    bubbles(page).filter({ hasText: oldest }),
    "окно не вытеснило самое старое",
  ).toHaveCount(0);

  await secondContext.close();
});
