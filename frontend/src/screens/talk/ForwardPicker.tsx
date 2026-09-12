import { Hash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, type Conversation, type Message } from "../../data/api.js";

/**
 * Куда переслать: список каналов поверх ленты.
 *
 * ⚠️ СВОЙ СЛОЙ, А НЕ ДИАЛОГ ИЗ НАБОРА. Диалог набора тянет за собой
 * блокировку прокрутки страницы, наложение и возврат фокуса — всё это
 * ради списка из трёх строк. Здесь достаточно слоя, который закрывается
 * по Escape и по щелчку мимо; ровно два правила, и оба видны в коде.
 *
 * Текущий разговор из списка не исключён намеренно: переслать себе же
 * в канал — обычный ход, когда реплику поднимают из глубины наверх.
 *
 * ⚠️ СПИСОК СПРАШИВАЕТСЯ ЗДЕСЬ, А НЕ БЕРЁТСЯ ИЗ ПАНЕЛИ. Панель с task-064
 * грузит чаты порциями: в ней нет тех, чья папка свёрнута, — а переслать
 * туда человек вправе. Запрос один и только на открытие этого окна.
 */
export function ForwardPicker({
  message,
  rooms,
  onPick,
  onClose,
}: {
  message: Message;
  /** Уже загруженные панелью — их показываем, пока едет полный список. */
  rooms: Conversation[];
  onPick: (conversationId: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState<Conversation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .conversations()
      .then(({ items }) => {
        if (!cancelled) setAll(items.filter((one) => one.parentId === null));
      })
      .catch(() => {
        // Не приехал — остаётся то, что уже знает панель. Пугать нечем:
        // переслать в открытые чаты всё равно можно.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Два способа закрыть: Escape и щелчок мимо.
   *
   * ⚠️ ЩЕЛЧОК МИМО СЛУШАЕТ ДОКУМЕНТ, А НЕ ПОДЛОЖКА. Обработчик на самой
   * подложке делает её интерактивной, не будучи кнопкой: программа чтения
   * экрана объявит её обычным блоком, а нажать с клавиатуры будет нечем.
   * Документ решает ту же задачу и никого не обманывает.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function outside(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", outside, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", outside, true);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 p-4">
      <div
        ref={box}
        className="flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-float"
      >
        <div className="border-b border-line px-4 py-3">
          <p className="text-lead font-medium text-ink">Переслать</p>
          <p className="mt-0.5 truncate text-aside text-muted">{message.body}</p>
        </div>

        <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1">
          {(all ?? rooms).map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => onPick(room.id)}
              className="flex w-auto items-center gap-2 rounded bg-transparent px-3 py-2 text-left text-body text-ink transition-colors hover:bg-raised"
            >
              <Hash className="size-4 shrink-0 opacity-60" />
              <span className="truncate">{room.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
