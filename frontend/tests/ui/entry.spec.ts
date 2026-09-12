import { expect, test } from "@playwright/test";

/**
 * ВИД ВХОДА (task-022): растр совпадает с пикселями экрана.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННЫЙ АРБИТР ЗАДАЧИ, И ГЛАЗОМ ЕГО НЕ ЗАМЕНИТЬ. Разница
 * между холстом в 960 пикселей и в 1920 на одном и том же месте экрана
 * выглядит как «чуть мягче» — то есть никак. Проверяется числом: сколько
 * пикселей у холста против того, сколько их в его половине экрана.
 *
 * ⚠️ МНОЖИТЕЛЬ ЭКРАНА ЗДЕСЬ ДВА, А НЕ ЕДИНИЦА. При единице равенство
 * выполняется само собой, даже если про множитель забыли вовсе, — проверка
 * была бы зелёной на сломанном коде.
 *
 * ⚠️ ЛОКАТОР ПО ТЕГУ, А НЕ ПО РОЛИ (Р-022 §3). Картинка украшательная
 * и объявлена скрытой от чтения с экрана: дать ей подпись значило бы
 * соврать тому, кто слушает страницу. Тег `canvas` при этом не разметка
 * и не класс — он и есть предмет проверки.
 */

test.use({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });

test.describe("вид входа", () => {
  test("холст считается в пикселях устройства и переживает изменение окна", async ({ page }) => {
    await page.goto("/");

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    const ratio = await page.evaluate(() => window.devicePixelRatio);
    expect(ratio).toBe(2);

    /** Что должно быть и что есть. Отдельной функцией — сверяем дважды. */
    const measure = async () => {
      const box = await canvas.boundingBox();
      const pixels = await canvas.evaluate((one) => (one as HTMLCanvasElement).width);
      return { should: Math.round((box?.width ?? 0) * ratio), pixels };
    };

    /** Совпало ли одно с другим. Сверяем оба числа разом: порознь они
     * успевают разъехаться между двумя опросами. */
    const matched = async () => {
      const { should, pixels } = await measure();
      return pixels > 1 && pixels === should;
    };

    // Ждём отрисовки: картинка ещё едет, растр считается по кадру.
    await expect.poll(matched, { timeout: 5000 }).toBe(true);

    // Окно потянули — растр обязан пересчитаться под новый размер.
    await page.setViewportSize({ width: 1000, height: 860 });
    await expect.poll(matched, { timeout: 5000 }).toBe(true);

    // И это должен быть ДРУГОЙ холст, а не тот же: иначе проверка выше
    // прошла бы и на коде, который считает растр один раз навсегда.
    const narrow = await measure();
    expect(narrow.pixels).toBeLessThan(1280 * 2);
  });

  test("вторая дверь переключает, а не отправляет форму", async ({ page }) => {
    await page.goto("/");

    // ⚠️ ЭТО ПРО ТИП КНОПКИ, А НЕ ПРО ВИД. Кнопка без объявленного типа
    // внутри формы отправляет её: нажатие меняло дверь И слало пустую
    // форму разом, а человек видел ошибки полей там, где ничего
    // не отправлял. Молчаливо — потому и проверяется машиной.
    const secondButton = page.getByRole("button", {
      name: /У меня уже есть вход|Создать новое пространство/u,
    });
    await expect(secondButton).toBeVisible();
    await secondButton.click();

    // Дверь сменилась…
    await expect(
      page.getByRole("heading", { name: /С возвращением|Создать пространство/u }),
    ).toBeVisible();
    // …и ни одного поля с ошибкой: отправки не было.
    await expect(page.locator("[aria-invalid='true']")).toHaveCount(0);
  });

  test("на узком окне картинки нет, форма занимает окно", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 860 });
    await page.goto("/");

    await expect(page.getByLabel("Почта")).toBeVisible();
    await expect(page.locator("canvas")).toBeHidden();
  });
});
