import { bubble, bubbles, createChannel, register, typeInto } from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * П-1: первая реплика в новом канале не мерцает.
 *
 * ⚠️ ЗАЧЕМ ОТДЕЛЬНЫЙ ТЕСТ РОВНО НА ЭТО. Это единственная поломка, про
 * которую точно известно, что глазами её проверяют неправильно: я объявлял
 * её починенной ЧЕТЫРЕ раза, и три раза это была неправда.
 *
 * ⚠️ МЕРЯЕМ ПРИЧИНУ, А НЕ ТО, ЧТО ВИДИТ ЧЕЛОВЕК, — и это признано в плане
 * (task-015, В-1). «Мигнуло» померить нельзя. Но мерцание рождалось ровно
 * из одного: узел реплики ПЕРЕСОЗДАЁТСЯ, когда сервер подтверждает
 * отправку и временный номер сменяется настоящим. Новый узел проигрывает
 * появление заново — вот и мигание. Другого пути у него нет.
 *
 * Проверяем два факта, каждый из которых был отдельной причиной:
 *   1. узел не удалялся из страницы — ключ строки пережил смену номера;
 *   2. на СВОЮ реплику не вешается появление: её сказал ты сам, и
 *      в Телеграме своя реплика не всплывает.
 */

/** Что записал наблюдатель за страницей. */
interface Removals {
  texts: string[];
  /** Тексты реплик, на которых запускалась анимация самой реплики. */
  animated: string[];
}

/**
 * ⚠️ НАБЛЮДАТЕЛЬ ВЕШАЕТСЯ НА ВСЮ СТРАНИЦУ, А НЕ НА ЛЕНТУ. У пустого
 * канала ленты не существует: вместо неё стоит приглашение написать
 * первое сообщение, и лента рождается вместе с первой репликой. Значит
 * узла, на котором можно стоять всё время сценария, внутри разговора нет.
 */
const WATCH = () => {
  const seen: Removals = { texts: [], animated: [] };
  (window as unknown as { amplifieRemovals: Removals }).amplifieRemovals = seen;

  // Появление — это анимация на самом узле реплики, как бы её ни назвали
  // и каким бы классом ни повесили. Анимации внутри реплики (значки) не в счёт.
  document.addEventListener("animationstart", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.tagName === "ARTICLE") {
      seen.animated.push(target.textContent ?? "");
    }
  });

  // Считаем только реплики: пропажа приглашения «здесь пока пусто» —
  // нормальная смена состояния, а не пересоздание реплики. `closest`
  // ловит и сам узел реплики, и её обёртку, снятую вместе с ней.
  const messageOf = (node: Node): HTMLElement | null =>
    node instanceof HTMLElement ? (node.closest("article") ?? node.querySelector("article")) : null;

  new MutationObserver((records) => {
    for (const record of records) {
      for (const gone of record.removedNodes) {
        const article = messageOf(gone);
        if (article) seen.texts.push(article.textContent ?? "");
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
};

test("первая реплика в новом канале не пересоздаётся при подтверждении", async ({ page }) => {
  await register(page);
  await createChannel(page, "Смета");

  // Пустая лента — именно тот случай, в котором ломалось. В непустой
  // черновик получал номер от соседей, и поломка не проявлялась.
  await expect(bubbles(page)).toHaveCount(0);

  // Наблюдатель ставится ДО отправки: смена узла происходит в те доли
  // секунды, за которые тест не успел бы ничего опросить.
  await page.evaluate(WATCH);

  const body = "первая строка в пустом канале";
  await typeInto(page, body, "Отправить");

  // Ждём подтверждения сервером: до него временный номер ещё жив, и
  // проверять нечего. Значок «доставлено» — то же, что видит человек.
  await expect(bubble(page, body).getByLabel("доставлено")).toBeVisible();

  const { texts: removed, animated } = await page.evaluate(
    () => (window as unknown as { amplifieRemovals: Removals }).amplifieRemovals,
  );
  expect(
    removed.filter((text) => text.includes(body)),
    "узел реплики удалялся — значит React пересоздал его, и появление проиграется заново",
  ).toEqual([]);

  /**
   * ⚠️ ПО ЗАПУСКУ АНИМАЦИИ, А НЕ ПО КЛАССУ `msg-fresh` (ревизия 27.09). Класс —
   * разметка: переименуй его — и «класса нет» зеленеет при всплывающей
   * реплике. Человек видит само движение; наблюдатель стоит с отправки,
   * поэтому ловит и появление, которое уже отыграло и снято.
   */
  expect(
    animated.filter((text) => text.includes(body)),
    "на свою реплику повешено появление: в Телеграме своя реплика не всплывает",
  ).toEqual([]);
});
