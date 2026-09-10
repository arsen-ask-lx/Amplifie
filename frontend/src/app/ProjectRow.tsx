import { CaretDown, CaretRight, DotsThree, FolderSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";

/**
 * Проект в боковой панели: заголовок и его чаты (Р-032).
 *
 * ⚠️ СВОЙ ФАЙЛ, ПОТОМУ ЧТО ЭТО СВОЙ ВОПРОС. `RoomList` отвечает на «из чего
 * состоит панель», `ChannelRow` — на «как устроена строка канала», а здесь
 * третий: «как выглядит папка и что она показывает, когда свёрнута».
 *
 * ⚠️ ЧАТЫ РИСУЮТСЯ ЧУЖОЙ ФУНКЦИЕЙ, А НЕ СВОЕЙ КОПИЕЙ СТРОКИ. Знание
 * о том, как устроена строка чата — значки, меню, выбор, — живёт
 * в одном месте (`ChannelRow`). Заведи мы здесь вторую строку, они
 * разъехались бы на первой же правке, и заметил бы это только человек.
 */

/**
 * Что показывает свёрнутый проект.
 *
 * ⚠️ СУММА, А НЕ ПРИЗНАК. Свёрнутая папка обязана сказать, сколько внутри
 * нового и звали ли тебя, — иначе сворачивать её никто не станет: свернул
 * и ослеп. Числа складываются по тем же правилам, что у канала, и берутся
 * у тех же счётчиков — второго способа считать непрочитанное здесь нет.
 */
function Сводка({ unread, mentions }: { unread: number; mentions: number }) {
  if (mentions <= 0 && unread <= 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {mentions > 0 ? (
        <span className="shrink-0 rounded-pill bg-accent px-1.5 py-0.5 text-mark text-on-accent tabular-nums">
          <span className="sr-only">упоминаний: {mentions}</span>
          <span aria-hidden="true">@</span>
        </span>
      ) : null}
      {unread > 0 ? (
        <span className="shrink-0 rounded-pill bg-accent px-1.5 py-0.5 text-mark text-on-accent tabular-nums">
          <span className="sr-only">непрочитанных: </span>
          {unread > 999 ? "999+" : unread}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Меню проекта: переименовать и убрать.
 *
 * ⚠️ ТРИ ТОЧКИ, КАК У КАНАЛА, И НЕ СЛУЧАЙНО. Действия над строкой панели
 * живут в одном и том же месте — иначе человеку приходится помнить,
 * у чего они справа, а у чего по правой кнопке.
 */
function МенюПроекта({
  project,
  onRename,
  onRemove,
}: {
  project: Project;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Что сделать с проектом «${project.title}»`}
          className={[
            "grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted transition-opacity",
            "hover:bg-selected hover:text-ink focus-visible:opacity-100",
            open ? "opacity-100" : "opacity-0 group-hover/project:opacity-100",
          ].join(" ")}
        >
          <DotsThree className="size-4" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={onRename}>Переименовать</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          Убрать проект
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectRow({
  project,
  channels,
  collapsed,
  onToggle,
  onAddChat,
  onRename,
  onRemove,
  unreadOf,
  mentionsOf,
  renderChannel,
  newChat,
}: {
  project: Project;
  /** Чаты этого проекта — только те, что человеку видны. Отбирает сервер. */
  channels: Conversation[];
  collapsed: boolean;
  onToggle: () => void;
  /** Завести чат ВНУТРИ этого проекта (task-035). */
  onAddChat: () => void;
  /**
   * Поле нового чата, когда его заводят здесь. `null` — не заводят.
   *
   * ⚠️ ГОТОВЫМ УЗЛОМ, А НЕ ФЛАЖКОМ «СЕЙЧАС ЗАВОДИМ». Папка не знает
   * ни как выглядит поле, ни куда уходит название, — а с флажком ей
   * пришлось бы принимать и то и другое.
   */
  newChat?: React.ReactNode;
  onRename: () => void;
  onRemove: () => void;
  unreadOf: (conversationId: string) => number;
  mentionsOf: (conversationId: string) => number;
  renderChannel: (channel: Conversation) => React.ReactNode;
}) {
  const сумма = (счёт: (id: string) => number) =>
    channels.reduce((всего, one) => всего + счёт(one.id), 0);

  return (
    <div className="group/project flex flex-col gap-0.5">
      <div className="flex items-center rounded pr-1 transition-colors hover:bg-raised">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-transparent px-2 py-1.5 text-left text-aside text-muted transition-colors hover:text-ink"
        >
          {collapsed ? (
            <CaretRight className="size-3 shrink-0" weight="bold" />
          ) : (
            <CaretDown className="size-3 shrink-0" weight="bold" />
          )}
          <FolderSimple className="size-4 shrink-0 opacity-60" />
          <span className="truncate font-medium">{project.title}</span>
          {/* Свёрнутый говорит числами; развёрнутый молчит — числа видны
            на самих чатах, и повторять их сверху значит сказать дважды. */}
          {collapsed ? <Сводка unread={сумма(unreadOf)} mentions={сумма(mentionsOf)} /> : null}
        </button>

        <МенюПроекта project={project} onRename={onRename} onRemove={onRemove} />
      </div>

      {collapsed ? null : (
        <div className="flex flex-col gap-0.5 pl-3">
          {channels.map((channel) => renderChannel(channel))}

          {newChat}

          {/* ⚠️ ЗАВОДКА ЧАТА ЖИВЁТ ВНУТРИ ПАПКИ, А НЕ СНАРУЖИ (task-035).
              Проект — это место, где чат РОЖДАЕТСЯ: человек сперва
              называет дело, потом говорит о нём. Кнопка стоит там, куда
              он уже смотрит, и заводит канал сразу с принадлежностью —
              одним запросом, а не «завести и переложить». */}
          {/* Пока поле открыто, кнопки нет: она превратилась в него. */}
          {newChat ? null : (
            <button
              type="button"
              onClick={onAddChat}
              aria-label={`Новый чат в проекте «${project.title}»`}
              className="flex items-center gap-2 rounded bg-transparent px-2.5 py-1.5 text-left text-aside text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Plus className="size-3.5 shrink-0" weight="bold" />
              Новый чат
            </button>
          )}
        </div>
      )}
    </div>
  );
}
