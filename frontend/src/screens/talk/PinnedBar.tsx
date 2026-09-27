import { CaretUp, List, PushPin, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { Message } from "../../data/api.js";
import { focusField } from "../../shared/ui/focusAfterClose.js";

/**
 * Полоска закреплённого над лентой.
 *
 * ⚠️ ПОКАЗЫВАЕТ ОДНО ИЗ НЕСКОЛЬКИХ, А НЕ ВСЕ РАЗОМ. Так у Телеграма,
 * и по делу: полоска отвечает на вопрос «что здесь главное», а не
 * «перечисли всё». Список из пяти строк наверху съел бы ленту ради того,
 * что читают раз в неделю.
 *
 * Отсюда три части, каждая со своей работой:
 *   ① СТОЛБИК СЛЕВА — сколько их всего и какое сейчас показано. Один
 *      закреплённый — столбика нет вовсе: делить нечего;
 *   ② САМА СТРОКА ведёт к сообщению, а нажатие на неё же перелистывает
 *      к следующему, если закреплённых больше одного. Так в Телеграме:
 *      полоска и указатель, и перелистыватель;
 *   ③ СПИСОК по значку справа — все закреплённые сразу, когда их правда
 *      надо просмотреть подряд.
 */
function Ticks({ count, at }: { count: number; at: number }) {
  if (count < 2) return null;
  return (
    <span aria-hidden="true" className="flex w-0.5 shrink-0 flex-col gap-0.5 self-stretch py-0.5">
      {Array.from({ length: Math.min(count, 5) }, (_, i) => `засечка-${i}`).map((name, i) => (
        <span
          key={name}
          className={[
            "flex-1 rounded-pill",
            i === at % Math.min(count, 5) ? "bg-accent" : "bg-line",
          ].join(" ")}
        />
      ))}
    </span>
  );
}

/** Кнопка-значок полоски: подпись и всплывающая подсказка — одна строка. */
function Icon({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-expanded": pressed })}
      className="grid size-7 shrink-0 place-items-center rounded bg-transparent text-muted outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
    >
      {children}
    </button>
  );
}

/** Все закреплённые подряд — когда их правда надо просмотреть списком. */
function PinnedList({
  pinned,
  onGo,
  onClose,
}: {
  pinned: Message[];
  onGo: (seq: number) => void;
  onClose: () => void;
}) {
  return (
    <ul className="max-h-52 overflow-y-auto border-t border-line px-1 py-1">
      {pinned.map((one) => (
        <li key={one.id}>
          <button
            type="button"
            onClick={() => {
              onGo(one.seq);
              onClose();
            }}
            className="flex w-full flex-col items-start gap-0.5 rounded bg-transparent px-2.5 py-1.5 text-left transition-colors hover:bg-raised"
          >
            <span className="text-mark font-medium text-accent-ink">{one.author.name}</span>
            <span className="w-full truncate text-aside text-muted">{one.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PinnedBar({
  pinned,
  onGo,
  onUnpin,
}: {
  pinned: Message[];
  onGo: (seq: number) => void;
  onUnpin: (message: Message) => void;
}) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);

  if (pinned.length === 0) return null;
  const shown = pinned[at % pinned.length];
  if (!shown) return null;

  const label =
    pinned.length > 1
      ? `Закреплённое ${(at % pinned.length) + 1} из ${pinned.length}`
      : "Закреплённое сообщение";

  return (
    <div className="shrink-0 border-b border-line bg-card">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <PushPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <Ticks count={pinned.length} at={at} />

        <button
          type="button"
          onClick={() => {
            onGo(shown.seq);
            // Как в Telegram: перешёл к закреплённому — и сразу печатаешь.
            // Фокус на кнопке полоски рисовал на ней рамку (владелец 26.09).
            focusField();
            // Перелистываем ПОСЛЕ перехода: следующее нажатие ведёт
            // к следующему закреплённому, как у них.
            if (pinned.length > 1) setAt((was) => (was + 1) % pinned.length);
          }}
          title="Перейти к закреплённому"
          className="flex min-w-0 flex-1 flex-col items-start rounded bg-transparent text-left outline-none focus-visible:bg-raised"
        >
          <span className="text-mark font-medium text-accent-ink">{label}</span>
          <span className="w-full truncate text-aside text-muted">{shown.body}</span>
        </button>

        {pinned.length > 1 ? (
          <Icon
            label={open ? "Свернуть список" : "Показать все закреплённые"}
            onClick={() => setOpen((was) => !was)}
            pressed={open}
          >
            {open ? <CaretUp className="size-4" /> : <List className="size-4" />}
          </Icon>
        ) : null}

        <Icon label="Открепить" onClick={() => onUnpin(shown)}>
          <X className="size-4" />
        </Icon>
      </div>

      {open ? <PinnedList pinned={pinned} onGo={onGo} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
