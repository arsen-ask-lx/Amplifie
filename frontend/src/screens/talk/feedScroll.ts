import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Focus } from "../../data/useChat.js";

/**
 * Поведение прокрутки ленты — целиком и в одном месте.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `Feed`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА, но шов
 * не выдуман под предел. `Feed` отвечает на вопрос «как лента выглядит»,
 * а здесь — «как она едет». Второй вопрос за месяц оброс пятью
 * отдельными правилами, и каждое стоит абзаца рядом с кодом: открытие,
 * догрузка старого, чужая перерисовка, приход нового, переход по цитате.
 * Смешанные с разметкой, они читались только целиком.
 */

/** Сколько держится подсветка найденной реплики. */
const HIGHLIGHT_MS = 2200;

/** Насколько близко к низу считается «человек внизу». */
const NEAR_BOTTOM = 80;

/** Насколько близко к верху начинается догрузка старого. */
const NEAR_TOP = 200;

export interface FeedScroll {
  box: RefObject<HTMLDivElement | null>;
  /** Лента в конце. Нужно только кнопке «вниз». */
  atBottom: boolean;
  onScroll: () => void;
  toBottom: () => void;
}

export function useFeedScroll({
  newest,
  count,
  hasOlder,
  onLoadOlder,
  focus,
}: {
  /** Номер самой свежей реплики — по его смене лента едет вниз. */
  newest: number;
  /** Сколько реплик сейчас: по его смене возвращается место после догрузки. */
  count: number;
  hasOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  focus: Focus | null;
}): FeedScroll {
  const box = useRef<HTMLDivElement>(null);

  /**
   * Кто листает назад — того не дёргает вниз новое сообщение.
   *
   * Это из Телеграма и важнее, чем кажется: человек читает старое,
   * приходит чужая реплика, и лента уезжает у него из-под глаз.
   */
  const stuckToBottom = useRef(true);

  /**
   * То же самое, но состоянием — ради кнопки «вниз».
   *
   * ⚠️ ДВА ХРАНИЛИЩА ОДНОГО ФАКТА, И ЭТО НЕ НЕДОСМОТР. Ссылка нужна внутри
   * обработчиков и кадров, где перерисовка не только не нужна, но и вредна:
   * лента дёргалась бы на каждый пиксель прокрутки. Состояние нужно ровно
   * одному — кнопке. Поэтому ссылка ведущая, состояние ведомое, и меняются
   * они в одной строке, а не в разных местах.
   */
  const [atBottom, setAtBottom] = useState(true);

  const loading = useRef(false);
  const keepFromBottom = useRef<number | null>(null);
  const settled = useRef(false);

  /**
   * Открытие разговора: сразу конец ленты, БЕЗ видимой прокрутки.
   *
   * `useLayoutEffect` отрабатывает до того, как браузер нарисует кадр,
   * поэтому «сверху, а потом поехали вниз» человек не увидит вовсе.
   * Так открывается чат в Телеграме, и это правильно: разговор читают
   * с конца, а начало — это то, куда листают намеренно.
   */
  useLayoutEffect(() => {
    const node = box.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  /**
   * Вернуть место после догрузки старого.
   *
   * ⚠️ `useLayoutEffect`, А НЕ КАДР ПОСЛЕ ЗАПРОСА. Первая редакция ставила
   * прокрутку в `requestAnimationFrame` сразу за ответом сервера — и та
   * отрабатывала ДО того, как React дорисовал страницу: измерено, лента
   * оставалась на нуле. Слой отрабатывает после расстановки узлов
   * и до кадра, поэтому прыжка не видно вовсе.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: место возвращается на приход реплик
  useLayoutEffect(() => {
    const node = box.current;
    const keep = keepFromBottom.current;
    if (!node || keep === null) return;
    node.scrollTop = node.scrollHeight - keep;
    keepFromBottom.current = null;
  }, [count]);

  /**
   * Держать низ, когда лента меняет размер не по своей воле.
   *
   * ⚠️ ЭТО И БЫЛО «ВСЁ ВЫРАВНИВАЕТСЯ ЧЕРЕЗ МИЛЛИСЕКУНДУ» (владелец).
   * При переключении канала лента рисуется и уезжает в конец ДО кадра,
   * а следом приезжает полоска закреплённого и занимает место сверху —
   * высота видимой части уменьшается, и содержимое сдвигается. То же
   * делает шрифт, дорисовавшийся после первого кадра.
   *
   * Наблюдатель за размером возвращает низ на место, пока человек и так
   * внизу. Тому, кто листает назад, не мешаем: там сдвиг — это его
   * собственная прокрутка, и трогать её нельзя.
   */
  useLayoutEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const watch = new ResizeObserver(() => {
      if (stuckToBottom.current) node.scrollTop = node.scrollHeight;
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // Догон после открытия дорисовывает ленту: доводим до низа мгновенно,
  // и только последующие сообщения приезжают плавно.
  useEffect(() => {
    const node = box.current;
    if (!node || newest === 0) return;
    if (!stuckToBottom.current) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instant = !settled.current || still;
    settled.current = true;

    const frame = requestAnimationFrame(() => {
      // Проверяем ЕЩЁ РАЗ, уже в кадре: между планированием и отрисовкой
      // человек мог уйти к цитате. Без этой строки переход отрабатывал,
      // подсвечивал реплику — и лента тут же уезжала обратно в конец.
      // Видно только глазами: подсветка-то ставилась, тест был бы зелёным.
      if (!stuckToBottom.current) return;
      if (instant) node.scrollTop = node.scrollHeight;
      else node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [newest]);

  /**
   * Переход по цитате: довести до реплики и отметить её.
   *
   * Отдельным правилом после того, которое уводит ленту в конец: иначе
   * прокрутка вниз перебила бы переход. Класс ставится напрямую, минуя
   * состояние, — подсветка живёт две секунды и перерисовки не стоит.
   */
  useEffect(() => {
    const node = box.current;
    if (!node || !focus) return;

    const found = node.querySelector<HTMLElement>(`[data-seq="${focus.seq}"]`);
    // Не нашли — цитата указывает на реплику, которой в ленте нет: удалена
    // либо дальше десяти страниц догрузки. Человек всё равно оказывается
    // в нужном разговоре, но подсветки не увидит. ⚠️ Это известный пробел:
    // экран не говорит, ПОЧЕМУ не подсветилось.
    if (!found) return;

    // Мы уже НЕ внизу ленты: иначе догон утащит человека обратно.
    stuckToBottom.current = false;

    // Мгновенно, а не плавно. Плавная прокрутка живёт на цикле кадров, а он
    // во вкладке без фокуса не крутится вовсе: подсветка ставилась, а лента
    // оставалась внизу. Поймано живым прогоном, из кода не видно. Здесь это
    // и не потеря: человек нажал «показать» и должен УВИДЕТЬ, а не ехать.
    found.scrollIntoView({ block: "center", behavior: "auto" });
    found.classList.add("msg-found");
    const timer = setTimeout(() => found.classList.remove("msg-found"), HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
      found.classList.remove("msg-found");
    };
  }, [focus]);

  /**
   * Догрузка старого — сама, при подходе к верху.
   *
   * ⚠️ КНОПКИ «ПОКАЗАТЬ БОЛЕЕ РАННЕЕ» БОЛЬШЕ НЕТ (владелец). Ни в одном
   * мессенджере её нет: листаешь вверх — старое появляется. Кнопка
   * требовала решения там, где человек уже выразил намерение движением.
   *
   * ⚠️ ЗАПОМИНАЕМ РАССТОЯНИЕ ДО НИЗА, А НЕ ПОЗИЦИЮ: оно не меняется
   * от добавленного сверху. Без этого лента прыгает, и человек теряет
   * строку, которую читал.
   */
  const onScroll = () => {
    const node = box.current;
    if (!node) return;
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM;
    stuckToBottom.current = near;
    setAtBottom((was) => (was === near ? was : near));

    if (node.scrollTop > NEAR_TOP || !hasOlder || loading.current) return;
    loading.current = true;
    keepFromBottom.current = node.scrollHeight - node.scrollTop;
    void Promise.resolve(onLoadOlder()).finally(() => {
      loading.current = false;
    });
  };

  const toBottom = () => {
    const node = box.current;
    if (!node) return;
    stuckToBottom.current = true;
    setAtBottom(true);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  return { box, atBottom, onScroll, toBottom };
}
