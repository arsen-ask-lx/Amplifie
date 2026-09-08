import { Hash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../data/api.js";
import { SidebarSection } from "./SidebarSection.js";

/**
 * Список разговоров — одной секцией «Каналы».
 *
 * Список приходит уже отсортированным по свежести: это делает сервер,
 * и переупорядочивать его здесь нельзя — два порядка разойдутся.
 *
 * ⚠️ ВЕТОК В ПАНЕЛИ НЕТ, И ЭТО ИСПРАВЛЕНИЕ. Они там были — вложенным
 * вторым уровнем со своим значком, — и это была выдумка: ни в Телеграме,
 * ни в Дискорде, ни в Слаке, ни в Buzz ветка не живёт в боковой панели.
 * В Дискорде она висит ПОД своим каналом внутри него, в Слаке открывается
 * панелью справа от сообщения.
 *
 * ⚠️ ПОИСКА ЗДЕСЬ ТОЖЕ НЕТ. В Buzz он есть — в приколотой шапке панели, —
 * но владелец сказал «точно не в боковой панели», и это его решение,
 * а не недосмотр.
 */

/** Поле нового канала: заводится на месте, в самой секции. */
function NewChannel({
  onCreate,
  onDone,
}: {
  onCreate: (title: string) => Promise<void>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => field.current?.focus(), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="px-1 py-0.5">
      <input
        ref={field}
        value={title}
        disabled={busy}
        placeholder="название канала"
        aria-label="Название нового канала"
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onDone()}
        // Пустое поле, потерявшее фокус, закрывается само: держать
        // на экране то, что человек уже мысленно закрыл, — мусор.
        onBlur={() => !title.trim() && onDone()}
        className="h-7 w-full rounded-lg border border-accent bg-card px-2 text-body text-ink outline-none placeholder:text-muted"
      />
    </form>
  );
}

export function RoomList({
  rooms,
  currentId,
  onSelect,
  onCreate,
}: {
  rooms: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  // Только корневые: ветка открывается из самого разговора, а не отсюда.
  const channels = rooms.filter((room) => room.parentId === null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarSection title="Каналы" addLabel="Новый канал" onAdd={() => setAdding(true)}>
        <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {adding ? <NewChannel onCreate={onCreate} onDone={() => setAdding(false)} /> : null}

          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              aria-current={channel.id === currentId ? "page" : undefined}
              onClick={() => onSelect(channel.id)}
              className={[
                "flex w-auto items-center gap-2 rounded px-2.5 py-1.5 text-left text-body transition-colors",
                channel.id === currentId
                  ? "bg-selected font-medium text-ink"
                  : "bg-transparent text-muted hover:bg-raised hover:text-ink",
              ].join(" ")}
            >
              <Hash className="size-4 shrink-0 opacity-60" />
              <span className="truncate">{channel.title}</span>
            </button>
          ))}

          {channels.length === 0 && !adding ? (
            <p className="px-2.5 py-2 text-aside text-muted">
              Каналов нет. Заведите первый — плюс в заголовке.
            </p>
          ) : null}
        </div>
      </SidebarSection>
    </div>
  );
}
