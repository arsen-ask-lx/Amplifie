import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "../data/api.js";
import { Icon } from "../shared/Icon.js";

/**
 * Список разговоров с поиском (Р-011).
 *
 * Список приходит уже отсортированным по свежести — это делает сервер,
 * и переупорядочивать его здесь нельзя: два порядка разойдутся.
 *
 * Поиск сужает, а не перекладывает. Папок нет намеренно: папка требует
 * работы ДО того, как принесёт пользу, а поиск и порядок не требуют
 * ничего. `Ctrl+K` ставит курсор в поиск из любого места — по описанию
 * самого Slack это самый быстрый способ перемещения.
 */

/** Ниже этого числа поиск только мешает: список и так виден целиком. */
const SEARCH_FROM = 7;

function matches(room: Conversation, needle: string): boolean {
  return room.title.toLowerCase().includes(needle);
}

/**
 * Сузить список по строке поиска.
 *
 * Ветка остаётся вместе со своим каналом в обе стороны: человек ищет
 * «договор» и должен увидеть ветку про договор — но без канала она
 * повиснет в воздухе, а канал без найденной ветки бесполезен.
 */
function narrow(rooms: Conversation[], needle: string): Conversation[] {
  const trimmed = needle.trim().toLowerCase();
  if (!trimmed) return rooms;

  const hit = new Set(rooms.filter((room) => matches(room, trimmed)).map((room) => room.id));
  for (const room of rooms) {
    if (!room.parentId) continue;
    if (hit.has(room.parentId)) hit.add(room.id);
    if (hit.has(room.id)) hit.add(room.parentId);
  }
  return rooms.filter((room) => hit.has(room.id));
}

export function RoomList({
  rooms,
  currentId,
  onSelect,
}: {
  rooms: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [needle, setNeedle] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.key === "k" && (event.ctrlKey || event.metaKey))) return;
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => narrow(rooms, needle), [rooms, needle]);

  const channels = shown.filter((r) => r.parentId === null);
  const threads = shown.filter((r) => r.parentId !== null);

  return (
    <>
      {rooms.length >= SEARCH_FROM ? (
        <input
          ref={search}
          className="h-8 w-full rounded border border-edge bg-bg px-2.5 text-aside text-ink outline-none placeholder:text-muted focus-visible:border-accent"
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setNeedle("");
          }}
          placeholder="Поиск (Ctrl+K)"
          aria-label="Поиск по разговорам"
        />
      ) : null}

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Разговоры">
        {channels.map((channel) => (
          <div key={channel.id}>
            <button
              type="button"
              className={[
                "flex w-auto items-center gap-2 rounded px-2.5 py-1.5 text-left text-body transition-colors",
                channel.id === currentId
                  ? "bg-selected font-medium text-ink"
                  : "bg-transparent text-muted hover:bg-raised hover:text-ink",
              ].join(" ")}
              aria-current={channel.id === currentId ? "page" : undefined}
              onClick={() => onSelect(channel.id)}
            >
              <Icon name="хэш" />
              <span className="truncate">{channel.title}</span>
            </button>
            {threads
              .filter((thread) => thread.parentId === channel.id)
              .map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={[
                    "ml-4 flex w-auto items-center gap-2 rounded px-2.5 py-1.5 text-left text-aside transition-colors",
                    thread.id === currentId
                      ? "bg-selected font-medium text-ink"
                      : "bg-transparent text-muted hover:bg-raised hover:text-ink",
                  ].join(" ")}
                  aria-current={thread.id === currentId ? "page" : undefined}
                  onClick={() => onSelect(thread.id)}
                >
                  <Icon name="ветка" />
                  <span className="truncate">{thread.title}</span>
                </button>
              ))}
          </div>
        ))}

        {shown.length === 0 ? (
          <p className="px-2.5 py-3 text-aside text-muted">Ничего не нашлось</p>
        ) : null}
      </nav>
    </>
  );
}
