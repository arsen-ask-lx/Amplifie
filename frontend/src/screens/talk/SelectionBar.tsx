import { ArrowBendUpRight, Copy, Trash, X } from "@phosphor-icons/react";
import type { Message } from "../../data/api.js";

/**
 * Полоса действий над выделенными репликами.
 *
 * ⚠️ «УДАЛИТЬ» ПОКАЗЫВАЕТСЯ, ТОЛЬКО ЕСЛИ ВЫДЕЛЕНЫ ОДНИ СВОИ. Кнопка,
 * которая на половине выделения молча ничего не сделает, хуже
 * отсутствующей: человек нажмёт её и решит, что удалилось всё.
 * Проверка идёт по самому выделению, а не по числу — так она остаётся
 * верной и когда выделено одно сообщение, и когда сорок.
 *
 * Счётчик склоняется правильно, потому что «Выбрано 1 сообщений» —
 * это тот самый мелкий мусор, из которого складывается ощущение, что
 * продукт делали второпях.
 */
export function messagesWord(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return "сообщение";
  if (!teen && last >= 2 && last <= 4) return "сообщения";
  return "сообщений";
}

export function SelectionBar({
  chosen,
  canRemove,
  onCopy,
  onForward,
  onRemove,
  onCancel,
}: {
  chosen: Message[];
  /** Можно ли удалить эту реплику: своё или модерирую здесь (Р-035). */
  canRemove: (message: Message) => boolean;
  onCopy: () => void;
  onForward: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  if (chosen.length === 0) return null;
  const removable = chosen.every(canRemove);

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line bg-card px-3 py-2">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Снять выделение"
        title="Снять выделение (Esc)"
        className="grid size-8 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="size-4" />
      </button>

      <span className="flex-1 text-body text-ink">
        Выбрано {chosen.length} {messagesWord(chosen.length)}
      </span>

      <button
        type="button"
        onClick={onCopy}
        className="flex w-auto items-center gap-2 rounded-lg bg-transparent px-3 py-1.5 text-body text-ink transition-colors hover:bg-raised"
      >
        <Copy className="size-4" />
        Копировать
      </button>
      <button
        type="button"
        onClick={onForward}
        className="flex w-auto items-center gap-2 rounded-lg bg-transparent px-3 py-1.5 text-body text-ink transition-colors hover:bg-raised"
      >
        <ArrowBendUpRight className="size-4" />
        Переслать
      </button>
      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          className="flex w-auto items-center gap-2 rounded-lg bg-transparent px-3 py-1.5 text-body text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash className="size-4" />
          Удалить
        </button>
      ) : null}
    </div>
  );
}
