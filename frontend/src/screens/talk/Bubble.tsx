import type { Message } from "../../data/api.js";
import { RichText } from "../../shared/RichText.js";
import { часы } from "../../shared/when.js";

/**
 * Реплика в ленте и всё, что решает, как она выглядит.
 *
 * ВЫНЕСЕНО ИЗ ЛЕНТЫ: у той осталось одно дело — прокрутка, догон и переход
 * по цитате, а это отдельная и непростая механика. Гейт размера файла был
 * прав: 312 строк означали, что в один файл дописывают всё, что рядом.
 *
 * Свои справа, чужие слева; подряд идущие от одного автора собираются
 * в группу и не повторяют имя; время живёт в нижнем крае пузыря; день
 * отбивается плашкой по центру (Р-008).
 *
 * Пузырь здесь не украшение: он кодирует «кто сказал» без подписи под
 * каждой строкой. Именно поэтому у продолжений группы имени нет —
 * сторона и цвет уже ответили на этот вопрос.
 */

/** Столько времени между сообщениями — и группа начинается заново. */
const REGROUP_MS = 5 * 60 * 1000;

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

export interface Row {
  message: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  newDay: boolean;
  fresh: boolean;
}

/** Что показать для каждого сообщения. Считается один раз, не в разметке. */
export function rowsOf(messages: Message[], meId: string, wasThere: number | null): Row[] {
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

/**
 * Реплика в ленте.
 *
 * ⚠️ ПРЕДЕЛ ШИРИНЫ — ГЛАВНОЕ, ЧТО ЗДЕСЬ ИЗМЕНИЛОСЬ (task-013). До него пузырь
 * тянулся во всю ленту: строка в сто знаков, глаз теряет начало следующей.
 * Комфортная мера давно измерена и равна 60–75 знакам, поэтому ширина
 * задана в `ch` — единицах ЗНАКА, а не в пикселях: она поедет вместе
 * со шрифтом, а мера останется той же.
 *
 * Время вынесено из потока текста в нижний край пузыря. Раньше оно стояло
 * встык за последним словом и толкало перенос строки.
 */
export function Bubble({ row }: { row: Row }) {
  const at = new Date(row.message.createdAt);

  return (
    // data-seq — по нему лента находит реплику при переходе из цитаты.
    <article
      data-seq={row.message.seq}
      className={[
        "msg flex items-end gap-2",
        row.mine ? "flex-row-reverse" : "",
        row.last ? "mb-3" : "mb-0.5",
        row.fresh ? "msg-fresh" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Кружок держит место у всей группы, но виден только у последнего:
          так строки одного автора стоят ровно, а лента не пестрит. */}
      {row.mine ? null : (
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-pill bg-accent-soft text-mark text-accent-ink"
        >
          {row.last ? initial(row.message.author.name) : ""}
        </span>
      )}
      <div
        className={[
          "max-w-[68ch] min-w-0 px-3 py-2 shadow-raised",
          row.mine
            ? "rounded-lg rounded-br-sm border border-accent-soft-edge bg-accent-soft text-ink"
            : "rounded-lg rounded-bl-sm border border-line bg-raised text-ink",
        ].join(" ")}
      >
        {row.first && !row.mine ? (
          <span className="mb-0.5 block text-aside font-medium text-accent-ink">
            {row.message.author.name}
          </span>
        ) : null}
        <span className="block text-body leading-relaxed break-words whitespace-pre-wrap">
          <RichText body={forDisplay(row.message.body)} />
        </span>
        <time
          dateTime={row.message.createdAt}
          className={[
            "mt-1 block text-right text-mark",
            row.mine ? "text-muted-on-soft" : "text-muted",
          ].join(" ")}
        >
          {часы.format(at)}
        </time>
      </div>
    </article>
  );
}
