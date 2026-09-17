import { expect, type Page, test } from "@playwright/test";
import {
  bubbles,
  createChannel,
  feedBox,
  login,
  openChannel,
  register,
  say,
  seedHistory,
} from "./fixtures.js";

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
  await seedHistory(page, playwright.request, SEEDED);

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
