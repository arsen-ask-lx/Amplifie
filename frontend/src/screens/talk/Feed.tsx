import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../../data/api.js";
import type { Focus } from "../../data/useChat.js";
import { день as dayOf } from "../../shared/when.js";
import type { Deeds, Picking } from "./Actions.js";
import { Group } from "./Group.js";
import { groupsOf, rowsOf } from "./rows.js";

/**
 * Лента сообщений — по модели Телеграма (Р-008).
 *
 * Свои справа, чужие слева; подряд идущие от одного автора собираются
 * в группу и не повторяют имя; время живёт внутри пузыря; день отбивается
 * плашкой по центру.
 *
 * Пузырь здесь не украшение: он кодирует «кто сказал» без подписи под
 * каждой строкой. Именно поэтому у продолжений группы имени нет —
 * сторона и цвет уже ответили на этот вопрос.
 */

function Empty() {
  return (
    <p className="p-8 text-center text-body text-muted">
      Здесь пока пусто. Напишите первое сообщение — с него начнётся канал.
    </p>
  );
}

/** Сколько держится подсветка найденной реплики. */
const HIGHLIGHT_MS = 2200;

export function Feed({
  messages,
  hasOlder,
  onLoadOlder,
  title,
  meId,
  focus,
  deeds,
  onGo,
  picking,
}: {
  messages: Message[];
  hasOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  title: string | undefined;
  meId: string;
  /** Реплика, из которой пришли по цитате. */
  focus: Focus | null;
  /** Что реплика умеет: ответить, переслать, закрепить, изменить, удалить. */
  deeds: Deeds;
  /** Перейти к реплике по её номеру — цитата и полоска ведут сюда же. */
  onGo: (seq: number) => void;
  /** Идёт выделение. `null` — обычный режим. */
  picking: Picking | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const newest = messages.at(-1)?.seq ?? 0;

  // Что было на экране при первом показе — не «новое». Иначе при открытии
  // канала оживает вся лента разом, а это ровно та примета: движение
  // на каждом блоке вместо движения там, где что-то изменилось.
  const wasThereAtFirst = useRef<number | null>(null);
  if (wasThereAtFirst.current === null && messages.length > 0) {
    wasThereAtFirst.current = newest;
  }

  /**
   * Открытие разговора: сразу конец ленты, БЕЗ видимой прокрутки.
   *
   * useLayoutEffect отрабатывает до того, как браузер нарисует кадр,
   * поэтому «сверху, а потом поехали вниз» человек не увидит вовсе.
   * Так открывается чат в Телеграме, и это правильно: разговор читают
   * с конца, а начало — это то, куда листают намеренно.
   *
   * Работает как «при открытии», потому что ChatScreen пересоздаёт ленту
   * при смене разговора (key по его идентификатору).
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: место возвращается на приход реплик, а не на смену отметки
  useLayoutEffect(() => {
    const node = box.current;
    const keep = keepFromBottom.current;
    if (!node || keep === null) return;
    node.scrollTop = node.scrollHeight - keep;
    keepFromBottom.current = null;
  }, [messages.length]);

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

  /**
   * Кто листает назад — того не дёргает вниз новое сообщение.
   *
   * Это тоже из Телеграма и это важнее, чем кажется: человек читает
   * старое, приходит чужая реплика, и лента уезжает у него из-под глаз.
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

  /**
   * Догрузка старого — сама, при подходе к верху.
   *
   * ⚠️ КНОПКИ «ПОКАЗАТЬ БОЛЕЕ РАННЕЕ» БОЛЬШЕ НЕТ (владелец). Ни в одном
   * мессенджере её нет: листаешь вверх — старое появляется. Кнопка
   * требовала решения там, где человек уже выразил намерение движением.
   *
   * ⚠️ ВЫСОТА ЗАПОМИНАЕТСЯ ДО ДОГРУЗКИ И ВОССТАНАВЛИВАЕТСЯ ПОСЛЕ. Без
   * этого лента прыгает: сверху дорисовывается страница, содержимое едет
   * вниз, и человек теряет строку, которую читал. Считаем не позицию,
   * а РАССТОЯНИЕ ДО НИЗА — оно не меняется от добавленного сверху.
   */
  const loading = useRef(false);
  const keepFromBottom = useRef<number | null>(null);

  const onScroll = () => {
    const node = box.current;
    if (!node) return;
    const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    stuckToBottom.current = near;
    setAtBottom((was) => (was === near ? was : near));

    if (node.scrollTop > 200 || !hasOlder || loading.current) return;
    loading.current = true;
    // Запоминаем расстояние ДО НИЗА: оно не меняется от добавленного сверху,
    // в отличие от позиции. Восстановит его слой ниже — до отрисовки кадра.
    keepFromBottom.current = node.scrollHeight - node.scrollTop;
    void Promise.resolve(onLoadOlder()).finally(() => {
      loading.current = false;
    });
  };

  // Догон после открытия дорисовывает ленту: доводим до низа мгновенно,
  // и только последующие сообщения приезжают плавно.
  const settled = useRef(false);
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
   * Отдельным эффектом после того, который уводит ленту в конец: иначе
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

  function toBottom() {
    const node = box.current;
    if (!node) return;
    stuckToBottom.current = true;
    setAtBottom(true);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  if (messages.length === 0) return <Empty />;

  const rows = rowsOf(messages, meId, wasThereAtFirst.current);

  return (
    // Обёртка нужна кнопке «вниз»: она висит НАД лентой и не должна
    // ни ездить вместе с ней, ни попадать в поток сообщений.
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* role="log" — новые сообщения читаются вслух программой чтения экрана. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        ref={box}
        onScroll={onScroll}
      >
        {hasOlder ? (
          <p className="mb-3 text-center text-aside text-muted" aria-live="polite">
            Загружаем более раннее…
          </p>
        ) : (
          <p className="mb-4 text-center text-aside text-muted">
            {title ? `Начало канала «${title}»` : "Начало канала"}
          </p>
        )}

        {groupsOf(rows).map((group) => (
          <div key={group[0]?.message.id}>
            {group[0]?.newDay ? (
              <p className="my-4 text-center">
                <span className="rounded-pill border border-line bg-card px-3 py-1 text-mark text-muted">
                  {dayOf.format(new Date(group[0].message.createdAt))}
                </span>
              </p>
            ) : null}
            <Group rows={group} deeds={deeds} onGo={onGo} picking={picking} />
          </div>
        ))}
      </div>

      {/* ⚠️ ПОЯВЛЯЕТСЯ, ТОЛЬКО КОГДА ЛЕНТА НЕ В КОНЦЕ. Кнопка «вниз», видная
          всегда, — это кнопка, которая в девяти случаях из десяти ничего
          не делает; такие перестают замечать. Так же у Телеграма. */}
      {atBottom ? null : (
        <button
          type="button"
          onClick={toBottom}
          aria-label="В конец ленты"
          title="В конец ленты"
          className="absolute right-4 bottom-4 grid size-10 place-items-center rounded-pill border border-line bg-card text-muted shadow-float transition-colors hover:text-ink"
        >
          <CaretDown className="size-5" />
        </button>
      )}
    </div>
  );
}
