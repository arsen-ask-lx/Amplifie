import { expect, test } from "@playwright/test";
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
const ОКНО = 300;

/** Заметно больше окна: иначе вытеснению нечего вытеснять. */
const ПОСЕЯНО = 360;

async function seed(page: import("@playwright/test").Page, count: number): Promise<void> {
  const id = new URL(page.url()).pathname.split("/").pop();
  await page.evaluate(
    async ({ id, count }) => {
      for (let i = 1; i <= count; i++) {
        // ⚠️ ПЕРВАЯ — С ОСОБЫМ ТЕКСТОМ. Искать «строка номер 1» нельзя:
        // то же вхождение есть у десятой, сотой и ещё сотни других,
        // и проверка «осталась одна» насчитала сто одиннадцать.
        const body = i === 1 ? "самая первая строка" : `строка номер ${i}`;
        await fetch(`/v1/conversations/${id}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, clientMsgId: crypto.randomUUID() }),
        });
      }
    },
    { id, count },
  );
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
async function toTheTop(page: import("@playwright/test").Page, total: number): Promise<void> {
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

test("листающий назад ничего не теряет, а вернувшийся вниз получает окно", async ({
  page,
  browser,
}) => {
  const person = await register(page);
  await createChannel(page, "Много");
  await seed(page, ПОСЕЯНО);

  // Начальная загрузка отдаёт одну страницу: полное окно лента набирает
  // только листанием назад. Это само по себе стоит проверить.
  expect(await bubbles(page).count()).toBeLessThan(ОКНО);
  await toTheTop(page, ПОСЕЯНО);

  // Человек стоит наверху и читает самое старое.
  const самаяСтарая = "самая первая строка";
  await expect(bubbles(page).filter({ hasText: самаяСтарая })).toHaveCount(1);

  // Вторая вкладка говорит что-то новое.
  const вторая = await browser.newContext();
  const другая = await вторая.newPage();
  await login(другая, person);
  await openChannel(другая, "Много");
  await say(другая, "свежая реплика сверху не режет");

  await expect(bubbles(page).filter({ hasText: "свежая реплика" })).toHaveCount(1);
  await expect(
    bubbles(page).filter({ hasText: самаяСтарая }),
    "у листающего назад вытеснили то, что он читает",
  ).toHaveCount(1);

  // А теперь он вернулся вниз — и следующая же реплика включает окно.
  //
  // ⚠️ ЖДЁМ, ПОКА КНОПКА «В КОНЕЦ» ПРОПАДЁТ. Она есть ровно тогда, когда
  // лента НЕ в конце, — то есть её исчезновение и означает «доехали».
  // Прокрутка плавная, а лента высотой в триста шестьдесят реплик едет
  // не мгновенно: без ожидания следующая реплика приходила, пока человек
  // ещё в пути, и окно правильно не включалось.
  await page.getByLabel("В конец ленты").click();
  await expect(page.getByLabel("В конец ленты")).toHaveCount(0);
  await say(другая, "вторая свежая реплика");
  await expect(bubbles(page).filter({ hasText: "вторая свежая" })).toHaveCount(1);

  await expect.poll(() => bubbles(page).count(), { timeout: 5_000 }).toBeLessThanOrEqual(ОКНО);
  await expect(
    bubbles(page).filter({ hasText: самаяСтарая }),
    "окно не вытеснило самое старое",
  ).toHaveCount(0);

  await вторая.close();
});
