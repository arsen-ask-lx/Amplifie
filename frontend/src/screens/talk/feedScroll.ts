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

/** Сколько держится подсветка найденной реплики — то же число, что у `found` в `styles.css`. */
const HIGHLIGHT_MS = 1000;

/** Насколько близко к низу считается «человек внизу». */
const NEAR_BOTTOM = 80;

/** Насколько близко к верху начинается догрузка старого. */
const NEAR_TOP = 200;

/** Догрузить край, если он уже не грузится: одна страница за раз. */
function loadEdge(busy: { current: boolean }, load: () => void | Promise<void>): void {
  if (busy.current) return;
  busy.current = true;
  void Promise.resolve(load()).finally(() => {
    busy.current = false;
  });
}

/**
 * Встать при первом показе на нужную реплику. `false` — такой на экране нет,
 * значит лента открывается в конце, как раньше.
 */
function openedAt(node: HTMLDivElement, boundary: number | null): boolean {
  if (boundary === null) return false;
  /**
   * ⚠️ ВСТАЁМ НА ЧЕРТУ, А НЕ НА ПЕРВУЮ НЕПРОЧИТАННУЮ. Черта стоит НАД ней,
   * и, прицелившись в реплику, мы уводили черту за верхний край: человек
   * видел непрочитанное, но не видел, откуда оно начинается (замер 18.09).
   * Нет черты (её прячет `splitAtLine`, когда граница старше загруженного) —
   * целимся в саму реплику.
   */
  const line = node.querySelector<HTMLElement>("[data-unread-line]");
  const target =
    line ??
    [...node.querySelectorAll<HTMLElement>("[data-seq]")].find(
      (one) => Number(one.getAttribute("data-seq")) > boundary,
    );
  if (!target) return false;
  node.scrollTop = Math.max(0, target.offsetTop - node.offsetTop - 12);
  return true;
}

/**
 * Наибольший номер, который человек видел ДО КОНЦА (task-107).
 *
 * ⚠️ «ДО КОНЦА» — ЭТО НИЖНИЙ КРАЙ НА ЭКРАНЕ, А НЕ ВСЯ РЕПЛИКА ЦЕЛИКОМ.
 * Первая редакция ждала реплику целиком (порог 1), и реплика выше экрана
 * не помещалась никогда: отметка застревала перед ней навсегда, и чат,
 * дочитанный до последней строки, горел числом (владелец, 26.09).
 * Половина реплики под краем экрана по-прежнему не считается.
 *
 * ⚠️ НАБЛЮДАТЕЛЬ ПЛЮС ПРОКРУТКА ТОЛЬКО ПО ВЫСОКИМ. Наблюдатель будит
 * на входе и выходе реплики, но нижний край высокой приезжает на экран
 * без пересечения порога. Поэтому показавшиеся, но не целиком, реплики
 * держим в наборе и на прокрутке меряем только их — одну-две, а не ленту.
 */
function watchSeen(node: HTMLDivElement, onSeen: (seq: number) => void): () => void {
  if (typeof IntersectionObserver === "undefined") return () => undefined;
  let top = 0;
  const partial = new Set<Element>();

  // ⚠️ ЗОВЁМ И БЕЗ РОСТА НОМЕРА. `seen` молча отбрасывает увиденное в окне
  // без фокуса, и сообщи мы номер один раз — он не дошёл бы никогда.
  const note = (seq: number) => {
    if (Number.isInteger(seq)) top = Math.max(top, seq);
    if (top > 0) onSeen(top);
  };
  const bottomShown = (one: Element) =>
    one.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1;
  const checkPartial = () => {
    for (const one of partial) {
      if (bottomShown(one)) note(Number(one.getAttribute("data-seq")));
    }
  };

  const watch = new IntersectionObserver(
    (entries) => {
      for (const one of entries) {
        if (!one.isIntersecting) partial.delete(one.target);
        else if (one.intersectionRatio >= 1) {
          partial.delete(one.target);
          note(Number(one.target.getAttribute("data-seq")));
        } else partial.add(one.target);
      }
      checkPartial();
    },
    { root: node, threshold: [0, 1] },
  );
  for (const one of node.querySelectorAll("[data-seq]")) watch.observe(one);
  node.addEventListener("scroll", checkPartial, { passive: true });
  return () => {
    watch.disconnect();
    node.removeEventListener("scroll", checkPartial);
  };
}

export interface FeedScroll {
  box: RefObject<HTMLDivElement | null>;
  /** Лента в конце. Нужно только кнопке «вниз». */
  atBottom: boolean;
  onScroll: () => void;
  toBottom: () => void;
}

export function useFeedScroll({
  newest,
  newestMine,
  count,
  hasOlder,
  onLoadOlder,
  hasNewer,
  onLoadNewer,
  onToLatest,
  focus,
  boundary,
  onSeen,
}: {
  /** Номер самой свежей реплики — по его смене лента едет вниз. */
  newest: number;
  /**
   * Самую свежую реплику сказал ТЫ.
   *
   * ⚠️ СВОЯ РЕПЛИКА УВОДИТ ЛЕНТУ ВНИЗ ВСЕГДА, даже если человек листал
   * историю. У Телеграма так же (`item->isSending()` → прыжок в конец),
   * и иначе получается нелепость: нажал Enter — и не видишь, что
   * отправил. Владелец поймал это словами «напечатал, нажал Enter,
   * и меня вниз не перелистнуло».
   *
   * Чужая реплика при этом ленту НЕ дёргает: читающего историю нельзя
   * выкидывать вниз чужим сообщением.
   */
  newestMine: boolean;
  /** Сколько реплик сейчас: по его смене возвращается место после догрузки. */
  count: number;
  hasOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  /**
   * Лента открыта не в конце (task-099). Тогда её низ — не низ разговора:
   * ничто не тянет ленту вниз, подход к низу догружает новее, а «в конец»
   * возвращает к свежему, а не едет по давнему.
   */
  hasNewer: boolean;
  onLoadNewer: () => void | Promise<void>;
  onToLatest: () => void;
  focus: Focus | null;
  /**
   * Последний прочитанный номер (task-107): при первом показе лента встаёт
   * на черту за ним. `null` — в конец, как раньше.
   */
  boundary: number | null;
  /** Наибольший номер, который человек и правда видел на экране. */
  onSeen: (seq: number) => void;
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
  const loadingNewer = useRef(false);
  /** Ссылкой: наблюдатель за размером и обработчики живут дольше одной отрисовки. */
  const detached = useRef(hasNewer);
  detached.current = hasNewer;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: только первый показ
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    /**
     * ⚠️ НА ПЕРВОЕ НЕПРОЧИТАННОЕ, ЕСЛИ ОНО ЕСТЬ (task-107). Телеграм при
     * открытии чата встаёт на полосу непрочитанного, а не в конец
     * (`countInitialScrollTop`), и владелец просил ровно это. Без номера —
     * как раньше, в конец: разговор читают с конца.
     *
     * ⚠️ БЕЗ ВСПЫШКИ. Подсветка — ответ на переход по цитате или поиску,
     * то есть на действие человека над репликой. Открытие чата им не является.
     */
    if (openedAt(node, boundary)) {
      stuckToBottom.current = false;
      setAtBottom(false);
      return;
    }
    node.scrollTop = node.scrollHeight;
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
      if (stuckToBottom.current && !detached.current) node.scrollTop = node.scrollHeight;
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // Догон после открытия дорисовывает ленту: доводим до низа мгновенно,
  // и только последующие сообщения приезжают плавно.
  useEffect(() => {
    const node = box.current;
    // Не в конце новое не приходит, а своя последняя реплика давнего окна —
    // не повод ехать вниз: иначе подход к низу звал бы следующую страницу,
    // и лента сама пролистала бы год (task-099).
    if (!node || newest === 0 || detached.current) return;
    // Своя реплика возвращает ленту вниз и возвращает туда же взгляд:
    // дальше человек снова «внизу», и следующие чужие реплики его тоже
    // подвинут — ровно как если бы он не листал.
    if (newestMine) stuckToBottom.current = true;
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
  }, [newest, newestMine]);

  /**
   * Что человек и правда видел (task-107): пересобираем наблюдателя
   * на каждую пришедшую страницу — узлы реплик новые.
   *
   * ⚠️ ОТМЕТКУ ШЛЁМ НЕ ОТСЮДА. Здесь только «видел до номера»; когда и что
   * сказать серверу, решает `useReading` и модуль окон (не чаще раза
   * в три секунды на чат).
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: число реплик — сигнал «узлы сменились»
  useEffect(() => {
    const node = box.current;
    return node ? watchSeen(node, onSeen) : undefined;
  }, [count, onSeen]);

  /**
   * Переход по цитате: довести до реплики и отметить её.
   *
   * Отдельным правилом после того, которое уводит ленту в конец: иначе
   * прокрутка вниз перебила бы переход. Класс ставится напрямую, минуя
   * состояние, — подсветка живёт секунду и перерисовки не стоит.
   *
   * ⚠️ ИЩЕТ ЦЕЛЬ И ПРИ СМЕНЕ ЧИСЛА РЕПЛИК, ПОКА НЕ НАЙДЁТ (task-099). Переход
   * внутри открытого чата меняет `focus` сразу, а окно вокруг цели приезжает
   * позже: искавший только при смене `focus` смотрел в старую ленту,
   * не находил и больше не искал. Один раз на каждый переход — иначе
   * каждая пришедшая реплика снова уводила бы к цели.
   */
  const highlighted = useRef<Focus | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: число реплик — сигнал «лента пришла», а не данные
  useEffect(() => {
    const node = box.current;
    if (!node || !focus || highlighted.current === focus) return;

    const found = node.querySelector<HTMLElement>(`[data-seq="${focus.seq}"]`);
    // Не нашли — окно ещё не пришло либо реплика удалена. ⚠️ Во втором
    // случае экран не говорит, ПОЧЕМУ не подсветилось: известный пробел.
    if (!found) return;
    highlighted.current = focus;

    // Мы уже НЕ внизу ленты: иначе догон утащит человека обратно.
    stuckToBottom.current = false;

    // Мгновенно, а не плавно. Плавная прокрутка живёт на цикле кадров, а он
    // во вкладке без фокуса не крутится вовсе: подсветка ставилась, а лента
    // оставалась внизу. Поймано живым прогоном, из кода не видно. Здесь это
    // и не потеря: человек нажал «показать» и должен УВИДЕТЬ, а не ехать.
    found.scrollIntoView({ block: "center", behavior: "auto" });
    found.classList.add("msg-found");
    // Таймер не снимается повторным запуском эффекта: тот перезапускается
    // от каждой пришедшей реплики, а подсветка обязана дожить свои секунды.
    setTimeout(() => found.classList.remove("msg-found"), HIGHLIGHT_MS);
  }, [focus, count]);

  /**
   * Окно короче экрана — прокрутки нет, и догрузка по прокрутке не случится
   * никогда (task-099). Догружаем сами, пока есть край и нечем листать.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: проверяется после каждой пришедшей страницы
  useEffect(() => {
    const node = box.current;
    if (!node || node.scrollHeight > node.clientHeight) return;
    if (hasNewer) loadEdge(loadingNewer, onLoadNewer);
    else if (hasOlder) loadEdge(loading, onLoadOlder);
  }, [count, hasOlder, hasNewer]);

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
    // Низ давнего отрезка — не низ разговора: кнопка «в конец» остаётся.
    const atEnd = near && !detached.current;
    stuckToBottom.current = atEnd;
    setAtBottom((was) => (was === atEnd ? was : atEnd));

    // Новое дописывается снизу и прокрутку не сдвигает — место беречь не надо.
    if (near && detached.current) loadEdge(loadingNewer, onLoadNewer);

    if (node.scrollTop > NEAR_TOP || !hasOlder || loading.current) return;
    keepFromBottom.current = node.scrollHeight - node.scrollTop;
    loadEdge(loading, onLoadOlder);
  };

  const toBottom = () => {
    // Из давнего — к свежему загрузкой, а не прокруткой по давнему.
    if (detached.current) {
      onToLatest();
      return;
    }
    const node = box.current;
    if (!node) return;
    stuckToBottom.current = true;
    setAtBottom(true);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  return { box, atBottom, onScroll, toBottom };
}
