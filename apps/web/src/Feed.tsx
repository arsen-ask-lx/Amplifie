import { useEffect, useRef } from "react";
import type { Message } from "./api.js";

/**
 * Лента сообщений.
 *
 * Подряд идущие сообщения одного автора не повторяют его имя: повтор имени
 * над каждой строкой — шум, из-за которого разговор читается как журнал.
 * Разделитель дня стоит потому, что кодирует смысл, а не потому что пусто.
 */

/** Столько времени между сообщениями — и автора надо назвать снова. */
const REGROUP_MS = 5 * 60 * 1000;

const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Нужно ли называть автора перед этим сообщением. */
function startsGroup(message: Message, previous: Message | undefined): boolean {
  if (!previous) return true;
  if (previous.author.id !== message.author.id) return true;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap > REGROUP_MS;
}

/** Классы сообщения: начало группы и «пришло только что». */
function classOf(message: Message, previous: Message | undefined, wasThere: number | null): string {
  const parts = ["msg"];
  if (startsGroup(message, previous)) parts.push("msg-head");
  if (wasThere !== null && message.seq > wasThere) parts.push("msg-fresh");
  return parts.join(" ");
}

function Empty() {
  return (
    <p className="feed-empty">
      Здесь пока пусто. Напишите первое сообщение — с него начнётся канал.
    </p>
  );
}

export function Feed({
  messages,
  hasOlder,
  onLoadOlder,
}: {
  messages: Message[];
  hasOlder: boolean;
  onLoadOlder: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const newest = messages.at(-1)?.seq ?? 0;

  // Что было на экране при первом показе — не «новое». Иначе при открытии
  // канала оживает вся лента разом, а это ровно та примета: движение
  // на каждом блоке вместо движения там, где что-то изменилось.
  const wasThereAtFirst = useRef<number | null>(null);
  if (wasThereAtFirst.current === null && messages.length > 0) {
    wasThereAtFirst.current = newest;
  }

  // Новое сообщение доводим до глаз. Зависимость — номер последнего:
  // от неё же зависит и первый показ, поэтому отдельного эффекта
  // «прокрутить при открытии» не нужно.
  useEffect(() => {
    if (newest === 0) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "end" });
  }, [newest]);

  if (messages.length === 0) return <Empty />;

  return (
    <div className="feed">
      {hasOlder ? (
        <button type="button" className="quiet feed-older" onClick={onLoadOlder}>
          Показать более раннее
        </button>
      ) : null}

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const at = new Date(message.createdAt);
        const newDay = !previous || !sameDay(at, new Date(previous.createdAt));

        return (
          <div key={message.id}>
            {newDay ? <p className="feed-day">{day.format(at)}</p> : null}
            <article className={classOf(message, previous, wasThereAtFirst.current)}>
              {startsGroup(message, previous) ? (
                <header className="msg-who">
                  <span className="msg-author">{message.author.name}</span>
                  <time dateTime={message.createdAt}>{time.format(at)}</time>
                </header>
              ) : null}
              <p className="msg-body">{message.body}</p>
            </article>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
