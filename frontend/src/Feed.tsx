import { useEffect, useLayoutEffect, useRef } from "react";
import type { Message } from "./api.js";
import { RichText } from "./RichText.js";
import type { Focus } from "./useChat.js";

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

/** Столько времени между сообщениями — и группа начинается заново. */
const REGROUP_MS = 5 * 60 * 1000;

const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function startsGroup(message: Message, previous: Message | undefined): boolean {
  if (!previous) return true;
  if (previous.author.id !== message.author.id) return true;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap > REGROUP_MS;
}

function endsGroup(message: Message, next: Message | undefined): boolean {
  return next === undefined || startsGroup(next, message);
}

/**
 * Три и больше переводов строки подряд сжимаются до одного пустого ряда.
 *
 * Хранимый текст не трогаем — по Р-002 он остаётся ровно таким, каким его
 * отправили. Это правило ПОКАЗА: полтора экрана пустоты внутри сообщения
 * разрывают разговор сильнее, чем помогает задуманная автором пауза.
 */
function forDisplay(body: string): string {
  return body.replace(/\n{3,}/gu, "\n\n");
}

/** Кружок с инициалом — вместо картинки, которой у нас нет. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function Empty() {
  return (
    <p className="feed-empty">
      Здесь пока пусто. Напишите первое сообщение — с него начнётся канал.
    </p>
  );
}

interface Row {
  message: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  newDay: boolean;
  fresh: boolean;
}

/** Что показать для каждого сообщения. Считается один раз, не в разметке. */
function rowsOf(messages: Message[], meId: string, wasThere: number | null): Row[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const first = startsGroup(message, previous);
    return {
      message,
      mine: message.author.id === meId,
      first,
      last: endsGroup(message, messages[index + 1]),
      newDay: !previous || !sameDay(new Date(message.createdAt), new Date(previous.createdAt)),
      fresh: wasThere !== null && message.seq > wasThere,
    };
  });
}

function Bubble({ row }: { row: Row }) {
  const at = new Date(row.message.createdAt);
  const shape = [
    "msg",
    row.mine ? "msg-mine" : "msg-theirs",
    row.first ? "msg-first" : "",
    row.last ? "msg-last" : "",
    row.fresh ? "msg-fresh" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // data-seq — по нему лента находит реплику при переходе из цитаты.
    <article className={shape} data-seq={row.message.seq}>
      {/* Кружок держит место у всей группы, но виден только у последнего:
          так строки одного автора стоят ровно, а лента не пестрит. */}
      {row.mine ? null : (
        <span className="msg-face" aria-hidden="true">
          {row.last ? initial(row.message.author.name) : ""}
        </span>
      )}
      <div className="bubble">
        {row.first && !row.mine ? (
          <span className="msg-author">{row.message.author.name}</span>
        ) : null}
        <span className="msg-text">
          <RichText body={forDisplay(row.message.body)} />
        </span>
        <time className="msg-time" dateTime={row.message.createdAt}>
          {time.format(at)}
        </time>
      </div>
    </article>
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
}: {
  messages: Message[];
  hasOlder: boolean;
  onLoadOlder: () => void;
  title: string | undefined;
  meId: string;
  /** Реплика, из которой пришли по цитате. */
  focus: Focus | null;
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
   * Кто листает назад — того не дёргает вниз новое сообщение.
   *
   * Это тоже из Телеграма и это важнее, чем кажется: человек читает
   * старое, приходит чужая реплика, и лента уезжает у него из-под глаз.
   */
  const stuckToBottom = useRef(true);
  const onScroll = () => {
    const node = box.current;
    if (!node) return;
    stuckToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
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

  if (messages.length === 0) return <Empty />;

  const rows = rowsOf(messages, meId, wasThereAtFirst.current);

  return (
    // role="log" — новые сообщения читаются вслух программой чтения экрана.
    <div
      className="feed"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      ref={box}
      onScroll={onScroll}
    >
      {hasOlder ? (
        <button type="button" className="quiet feed-older" onClick={onLoadOlder}>
          Показать более раннее
        </button>
      ) : (
        <p className="feed-start">{title ? `Начало канала «${title}»` : "Начало канала"}</p>
      )}

      {rows.map((row) => (
        <div key={row.message.id}>
          {row.newDay ? (
            <p className="feed-day">
              <span>{day.format(new Date(row.message.createdAt))}</span>
            </p>
          ) : null}
          <Bubble row={row} />
        </div>
      ))}
    </div>
  );
}
