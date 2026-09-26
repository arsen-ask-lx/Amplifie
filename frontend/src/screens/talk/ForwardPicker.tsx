import { Hash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, type Conversation, type Message } from "../../data/api.js";
import { usePausedAsk } from "../../data/usePausedAsk.js";
import { Button } from "../../shared/ui/button.js";
import { CommandField } from "../../shared/ui/command-field.js";
import { focusAfterClose, focusField } from "../../shared/ui/focusAfterClose.js";
import { useDismiss } from "../../shared/useDismiss.js";

/**
 * Куда переслать: поле поиска и список чатов поверх ленты (task-117).
 *
 * ⚠️ ПУСТОЕ ПОЛЕ СЕРВЕР НЕ СПРАШИВАЕТ. Прежде окно брало весь список
 * пространства (Д-41: 1,4 МБ), а список «по свежести» стоит сервера дорого —
 * свежесть считается у каждого чата. Пустое поле показывает то, что панель
 * уже знает; свёрнутые папки находятся набором.
 *
 * ⚠️ ENTER ПЕРЕСЫЛАЕТ ТОЛЬКО ИЗ СПИСКА, КОТОРЫЙ СООТВЕТСТВУЕТ НАБРАННОМУ.
 * Пока сервер думает, показаны чаты панели, отфильтрованные по строке на
 * месте, а не прежняя выдача: реплика, ушедшая в первый попавшийся чат,
 * уже прочитана получателями — отменить нечем.
 *
 * ⚠️ СВОЙ СЛОЙ, А НЕ ДИАЛОГ НАБОРА, КАК У ОКНА ПОИСКА ПО СООБЩЕНИЯМ. Нужны
 * Escape и щелчок мимо (`useDismiss`); после закрытия курсор возвращается
 * в поле ввода чата. Ловушки Tab нет — у обоих окон, записано в очередь.
 *
 * Текущий разговор из списка не исключён намеренно: переслать себе же
 * в канал — обычный ход, когда реплику поднимают из глубины наверх.
 */

/** Строка для сравнения: без регистра и без разницы ё и е — как ищет сервер. */
function plain(text: string): string {
  return text.trim().toLowerCase().replaceAll("ё", "е");
}

/** Строка состояния под полем: отказ с «Повторить» или «ничего». */
function Status({
  failed,
  empty,
  onRetry,
}: {
  failed: boolean;
  empty: boolean;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 text-aside text-danger">
        <p>Не удалось найти чаты</p>
        <Button variant="outline" size="xs" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }
  return empty ? <p className="px-4 py-3 text-aside text-muted">Ничего не нашлось</p> : null;
}

export function ForwardPicker({
  message,
  rooms,
  onPick,
  onClose,
}: {
  message: Message;
  /** Чаты, которые уже знает панель, — список пустого поля. */
  rooms: Conversation[];
  onPick: (conversationId: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const key = plain(query);
  const asked = usePausedAsk<Conversation[]>({
    key,
    blank: key === "",
    short: false,
    ask: (signal) => api.findChats(query, signal).then((found) => found.items),
  });

  const known = rooms.filter((room) => room.parentId === null);
  const answer = asked.state.kind === "найдено" && asked.state.key === key ? asked.state : null;
  const found = answer !== null;
  const shown: Conversation[] =
    answer?.value ?? known.filter((room) => plain(room.title).includes(key));

  // ⚠️ ОКНО ОТКРЫВАЮТ ИЗ МЕНЮ ПО ПРАВОЙ КНОПКЕ, А МЕНЮ, ЗАКРЫВАЯСЬ, РЕШАЕТ,
  // КУДА ДЕТЬ ФОКУС. Своего `autoFocus` полю мало: меню доигрывает закрытие
  // позже и отпускает фокус на страницу, а набор со страницы уходит в поле
  // реплики — буквы «смета» оказывались в сообщении (пойман сценарием П-7).
  useEffect(() => {
    focusAfterClose(() => box.current?.querySelector("input")?.focus());
  }, []);

  // Новая строка — выбор снова сверху.
  // biome-ignore lint/correctness/useExhaustiveDependencies: сброс по смене строки и есть смысл
  useEffect(() => setActive(0), [key]);

  const close = () => {
    onClose();
    focusField();
  };
  const pick = (room: Conversation | undefined) => {
    if (!room) return;
    onPick(room.id);
    focusField();
  };

  // Escape и щелчок мимо — общим правилом слоёв (`useDismiss`).
  useDismiss(box, close);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 p-4">
      <div
        ref={box}
        role="dialog"
        aria-label="Переслать"
        className="flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-float"
      >
        <div className="px-4 pt-3">
          <p className="text-lead font-medium text-ink">Переслать</p>
          <p className="mt-0.5 truncate text-aside text-muted">{message.body}</p>
        </div>

        <CommandField
          value={query}
          label="Куда переслать"
          placeholder="Найти чат"
          onChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((at) => Math.min(at + 1, shown.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(shown[active]);
            }
          }}
        />

        <Status
          failed={asked.state.kind === "отказ"}
          empty={found && shown.length === 0}
          onRetry={asked.retry}
        />

        {shown.length > 0 ? (
          <div
            role="listbox"
            aria-label="Чаты"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1"
          >
            {shown.map((room, at) => (
              <div
                key={room.id}
                role="option"
                aria-selected={at === active}
                tabIndex={-1}
                onClick={() => pick(room)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") pick(room);
                }}
                className={[
                  "flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-body text-ink transition-colors",
                  at === active ? "bg-raised" : "hover:bg-raised",
                ].join(" ")}
              >
                <Hash className="size-4 shrink-0 opacity-60" />
                <span className="truncate">{room.title}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
