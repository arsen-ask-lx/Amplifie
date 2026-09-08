import { Pin, X } from "lucide-react";
import type { Message } from "../../data/api.js";

/**
 * Полоска закреплённого над лентой.
 *
 * ⚠️ ПОКАЗЫВАЕТ ОДНО, А НЕ ВСЕ. Закреплённых бывает несколько, но полоска
 * отвечает на вопрос «что здесь главное», а не «перечисли всё». Список
 * из пяти строк наверху съел бы ленту ради того, что читают раз в неделю.
 * Так в Телеграме: сверху последнее, остальные — по счётчику.
 *
 * Счётчика у нас пока нет, и это честный пробел, а не забытая мелочь:
 * пока закреплённое одно, показывать «1 из 3» нечего.
 *
 * Щелчок ведёт к самому сообщению — тем же переходом, что и цитата.
 */
export function PinnedBar({
  pinned,
  onGo,
  onUnpin,
}: {
  pinned: Message[];
  onGo: (seq: number) => void;
  onUnpin: (message: Message) => void;
}) {
  const top = pinned[0];
  if (!top) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card px-3 py-1.5">
      <Pin className="size-4 shrink-0 text-muted" aria-hidden="true" />

      <button
        type="button"
        onClick={() => onGo(top.seq)}
        title="Перейти к закреплённому"
        className="flex min-w-0 flex-1 flex-col items-start bg-transparent text-left"
      >
        <span className="text-mark font-medium text-accent-ink">Закреплённое сообщение</span>
        <span className="w-full truncate text-aside text-muted">{top.body}</span>
      </button>

      <button
        type="button"
        onClick={() => onUnpin(top)}
        aria-label="Открепить"
        title="Открепить"
        className="grid size-7 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
