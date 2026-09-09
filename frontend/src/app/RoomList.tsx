import { DotsThree, Hash, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../data/api.js";
import { Button } from "../shared/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";
import { ChannelRow } from "./ChannelRow.js";
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
  unreadOf,
  onSelect,
  onCreate,
  onRemove,
}: {
  rooms: Conversation[];
  currentId: string | null;
  /** Сколько чужих реплик человек не видел в этом канале (Р-029). */
  unreadOf: (conversationId: string) => number;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  /**
   * Какой канал спрашиваем «точно удалить?».
   *
   * ⚠️ СПРАШИВАЕМ, И ЭТО НЕ ПЕРЕСТРАХОВКА. Реплику удаляет её автор
   * и только свою; канал сносит переписку целиком и у всех. Действие
   * необратимое для того, кто смотрит, — значит между «промахнулся мышью»
   * и «переписки нет» обязан стоять один явный шаг.
   */
  const [removing, setRemoving] = useState<Conversation | null>(null);

  // Только корневые: ветка открывается из самого разговора, а не отсюда.
  const channels = rooms.filter((room) => room.parentId === null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarSection title="Каналы" addLabel="Новый канал" onAdd={() => setAdding(true)}>
        <div className="hide-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {adding ? <NewChannel onCreate={onCreate} onDone={() => setAdding(false)} /> : null}

          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              current={channel.id === currentId}
              unread={unreadOf(channel.id)}
              onSelect={onSelect}
              onRemove={() => setRemoving(channel)}
            />
          ))}

          {channels.length === 0 && !adding ? (
            <p className="px-2.5 py-2 text-aside text-muted">
              Каналов нет. Заведите первый — плюс в заголовке.
            </p>
          ) : null}
        </div>
      </SidebarSection>

      <ConfirmRemoval
        channel={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={async (id) => {
          setRemoving(null);
          await onRemove(id);
        }}
      />
    </div>
  );
}

/**
 * Строка канала: название и три точки справа.
 *
 * ⚠️ ТРИ ТОЧКИ, А НЕ ПРАВАЯ КНОПКА. Сначала действия висели на правой
 * кнопке — как у реплики в ленте. Владелец сказал прямо: неудобно, и он
 * прав. Правая кнопка не видна: о ней надо ЗНАТЬ. В ленте это терпимо —
 * там так у Телеграма, и человек приходит с этой привычкой; в боковой
 * панели привычка другая, её задали ChatGPT и Claude, и там действия
 * живут на трёх точках.
 *
 * ⚠️ ТОЧКИ ПОЯВЛЯЮТСЯ ПО НАВЕДЕНИЮ, но остаются видимыми, пока меню
 * открыто или на них фокус. Иначе меню открывалось бы и тут же теряло
 * свою кнопку, а с клавиатуры до неё было бы не добраться вовсе.
 *
 * ⚠️ ДВЕ КНОПКИ РЯДОМ, А НЕ КНОПКА В КНОПКЕ. Вложенная кнопка — неверная
 * разметка: браузер её распрямляет, и нажатие на точки выбирало бы канал
 * заодно.
 */

/**
 * «Точно удалить канал?» — своим окном, а не `window.confirm`.
 *
 * Родное окно браузера рисуется поверх страницы чужим видом, не знает
 * наших тем и на Windows выглядит как ошибка системы, а не как вопрос
 * приложения. Здесь тот же вид, что и у остального.
 */
function ConfirmRemoval({
  channel,
  onCancel,
  onConfirm,
}: {
  channel: Conversation | null;
  onCancel: () => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  if (!channel) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="removal-title"
      onKeyDown={(event) => event.key === "Escape" && onCancel()}
    >
      <div className="w-full max-w-96 rounded-xl border border-line bg-card p-5 shadow-float">
        <h2 id="removal-title" className="text-lead font-medium text-ink">
          Удалить «{channel.title}»?
        </h2>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Канал исчезнет у всех, кто его видит, вместе со всей перепиской. Вернуть его из приложения
          будет нельзя.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            autoFocus
            onClick={() => void onConfirm(channel.id)}
          >
            Удалить
          </Button>
        </div>
      </div>
    </div>
  );
}
