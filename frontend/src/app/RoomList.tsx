import { useEffect, useRef, useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import { Button } from "../shared/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog.js";
import { Input } from "../shared/ui/input.js";
import { ChannelRow } from "./ChannelRow.js";
import { ProjectRow } from "./ProjectRow.js";
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
      <Input
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
        className="h-7 border-accent bg-card px-2"
      />
    </form>
  );
}

/**
 * Какие проекты свёрнуты. Переживает перезагрузку страницы.
 *
 * ⚠️ ЛИЧНОЕ И ТОЛЬКО ЛИЧНОЕ, поэтому в браузере, а не на сервере.
 * «Свернул папку» — это про мой сегодняшний взгляд, а не про устройство
 * пространства; уехав на сервер, оно свернуло бы папку всем сразу.
 *
 * ⚠️ ЧТЕНИЕ И ЗАПИСЬ В `try`. Хранилище бывает закрыто настройками
 * приватности, и это выбор человека, а не поломка: не прочлось — все
 * папки развёрнуты, и панель работает.
 */
const ЯЩИК = "amplifie:свёрнутые-проекты";

function useСвёрнутые() {
  const [свёрнуты, setСвёрнуты] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(ЯЩИК) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const свернуть = (id: string) => {
    setСвёрнуты((было) => {
      const стало = new Set(было);
      if (стало.has(id)) стало.delete(id);
      else стало.add(id);
      try {
        localStorage.setItem(ЯЩИК, JSON.stringify([...стало]));
      } catch {
        // Не сохранилось — папка свернётся снова после перезагрузки.
        // Это неудобство, а не поломка, и молчать о нём здесь уместно.
      }
      return стало;
    });
  };

  return { свёрнуты, свернуть };
}

export function RoomList({
  rooms,
  projects,
  currentId,
  unreadOf,
  mentionsOf,
  onSelect,
  onCreate,
  onMove,
  onRemove,
}: {
  rooms: Conversation[];
  /** Проекты, в которых человеку виден хоть один чат (Р-032). */
  projects: Project[];
  currentId: string | null;
  /** Сколько чужих реплик человек не видел в этом канале (Р-029). */
  unreadOf: (conversationId: string) => number;
  mentionsOf: (conversationId: string) => number;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  /** Отнести чат к проекту либо снять принадлежность (`null`). */
  onMove: (conversationId: string, projectId: string | null) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const { свёрнуты, свернуть } = useСвёрнутые();
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
  const внеПроектов = channels.filter((one) => one.projectId === null);

  /**
   * Строка канала одна и та же внутри проекта и снаружи.
   *
   * ⚠️ ФУНКЦИЕЙ, А НЕ ДВУМЯ КУСКАМИ РАЗМЕТКИ. Два куска разъедутся
   * на первой же правке — у одного появится значок, у другого нет.
   */
  const строка = (channel: Conversation) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      projects={projects}
      current={channel.id === currentId}
      unread={unreadOf(channel.id)}
      mentions={mentionsOf(channel.id)}
      onSelect={onSelect}
      onMove={onMove}
      onRemove={() => setRemoving(channel)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarSection title="Каналы" addLabel="Новый канал" onAdd={() => setAdding(true)}>
        <div className="hide-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {adding ? <NewChannel onCreate={onCreate} onDone={() => setAdding(false)} /> : null}

          {/* ⚠️ ПРОЕКТЫ СВЕРХУ, ОДИНОЧКИ СНИЗУ. Папка — это про предмет,
              и предметное идёт первым; «Общий» и курилка живут под ними,
              как и было до проектов. У кого проектов нет, панель прежняя
              знак в знак. */}
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              channels={channels.filter((one) => one.projectId === project.id)}
              collapsed={свёрнуты.has(project.id)}
              onToggle={() => свернуть(project.id)}
              unreadOf={unreadOf}
              mentionsOf={mentionsOf}
              renderChannel={строка}
            />
          ))}

          {внеПроектов.map((channel) => строка(channel))}

          {channels.length === 0 && projects.length === 0 && !adding ? (
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
    // Общее окно, а не свой `div role="dialog"`: ловушка фокуса, Escape
    // и блокировка прокрутки фона живут в одном месте (`ui/dialog.tsx`).
    <Dialog open onOpenChange={(открыто) => !открыто && onCancel()}>
      <DialogContent className="sm:max-w-96">
        <DialogHeader>
          <DialogTitle>Удалить «{channel.title}»?</DialogTitle>
          <DialogDescription>
            Канал исчезнет у всех, кто его видит, вместе со всей перепиской. Вернуть его из
            приложения будет нельзя.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Отмена
            </Button>
          </DialogClose>
          {/* ⚠️ ФОКУС НА «УДАЛИТЬ», И ЭТО НЕ ОПЕЧАТКА. Окно открывается
              из меню, где человек уже выбрал «удалить канал»: он пришёл
              сюда подтвердить, а не передумать. Отмена рядом и достижима
              и мышью, и Escape. */}
          <Button
            type="button"
            variant="destructive"
            autoFocus
            onClick={() => void onConfirm(channel.id)}
          >
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
