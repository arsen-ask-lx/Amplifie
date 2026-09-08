import { PencilSimple, X } from "@phosphor-icons/react";
import type { Message, Quote as Цитата } from "../../data/api.js";
import { Quote } from "./Quote.js";

/**
 * Строка над полем: на что отвечаем либо что правим.
 *
 * ⚠️ ОДНО МЕСТО НА ДВА СОСТОЯНИЯ, И ЭТО НЕ ЭКОНОМИЯ. Ответ и правка
 * взаимно исключают друг друга — нельзя править реплику, одновременно
 * отвечая на другую, — а две полоски друг над другом как раз и обещали бы,
 * что можно.
 */
export function Above({
  replying,
  editing,
  onCancel,
}: {
  replying: Цитата | null;
  editing: Message | null;
  onCancel: () => void;
}) {
  if (!replying && !editing) return null;

  return (
    <div className="mb-1 flex items-center gap-2 border-b border-line pb-1">
      {editing ? (
        <>
          <PencilSimple className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-mark font-medium text-accent-ink">Изменение сообщения</span>
            <span className="truncate text-aside text-muted">{editing.body}</span>
          </span>
        </>
      ) : replying ? (
        <span className="min-w-0 flex-1">
          <Quote quote={replying} />
        </span>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        aria-label="Отменить"
        title="Отменить (Esc)"
        className="grid size-7 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
