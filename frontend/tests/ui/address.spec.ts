import { bubble, createChannel, openChannel, register, say } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * П-3 плана task-067: вкладка чужого разговора не идёт за лентой.
 *
 * ⚠️ ЭТО ПРОВЕРКА ЭКОНОМИИ, А НЕ КАРТИНКИ. Замер показал 209 транзакций
 * базы на одну реплику при ста вкладках — потому что клиент шёл в догон
 * на ЛЮБОЙ звонок, даже о чате, который не открыт. Звонок теперь несёт
 * адрес, и клиент обязан его слушать. Без этого сценария экономия тихо
 * вернётся при первой правке `useChat`: глазами она не видна.
 *
 * Считаем запросы, а не время: время на стенде дрожит, число — нет.
 */

test("сообщение в другом чате не вызывает запроса ленты", async ({ page }) => {
  await register(page);
  await createChannel(page, "Смета");
  await createChannel(page, "Соседний");

  // Открыт «Соседний», а писать будем в «Смету».
  await openChannel(page, "Соседний");
  await say(page, "я тут");
  await expect(bubble(page, "я тут")).toBeVisible();

  const caughtUp: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/sync")) caughtUp.push(request.url());
  });

  /**
   * ⚠️ ЖДЁМ ПРИЗНАК, А НЕ СЕКУНДЫ. Проверяется ОТСУТСТВИЕ запроса,
   * а у отсутствия нет события — соблазн поставить паузу. Пауза делает
   * тест либо медленным, либо мигающим, и Playwright её не советует.
   * Ждём вместо неё положительный признак: на любой звонок клиент
   * перечитывает панель, значит запрос панели — доказательство, что
   * звонок доехал И обработан. Порядок в обработчике наш: догон стоял
   * бы ПЕРЕД панелью, поэтому к этому моменту он бы уже случился.
   */
  const panelAgain = page.waitForRequest((request) => request.url().includes("/v1/panel"));

  // Пишем в «Смету» из второй вкладки того же человека: свой же звонок
  // о чужом (не открытом) разговоре — ровно проверяемый случай.
  const other = await page.context().newPage();
  await other.goto("/");
  await openChannel(other, "Смета");
  await say(other, "смета на сто рублей");

  await panelAgain;

  expect(caughtUp, "догон из вкладки, которой это сообщение не касается").toHaveLength(0);
  // И экран первой вкладки при этом жив: реплика чужого чата тут не нужна,
  // а своя — на месте.
  await expect(bubble(page, "я тут")).toBeVisible();
  await expect(bubble(page, "смета на сто рублей")).toHaveCount(0);

  await other.close();
});
