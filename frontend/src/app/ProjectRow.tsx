import { DotsThree, Plus, PushPin, PushPinSlash } from "@phosphor-icons/react";
import { useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import { ЗначокПроекта } from "../shared/projectLook.js";
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
 * ⚠️ ЧАТЫ РИСУЮТСЯ ЧУЖОЙ ФУНКЦИЕЙ, А НЕ СВОЕЙ КОПИЕЙ СТРОКИ. Строка канала
 * внутри проекта и снаружи — одна и та же строка: те же значки, то же меню,
 * та же плотность. Заведи мы здесь вторую — они разъедутся на первой же
 * правке, и заметит это только человек.
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
  onPin,
  onRename,
  onRemove,
}: {
  project: Project;
  onPin: (pinned: boolean) => Promise<void>;
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
        <DropdownMenuItem onSelect={() => void onPin(!project.pinned)}>
          {project.pinned ? <PushPinSlash /> : <PushPin />}
          {project.pinned ? "Открепить" : "Закрепить"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
  onPin,
  onRename,
  onRemove,
  unreadOf,
  mentionsOf,
  renderChannel,
}: {
  project: Project;
  /** Чаты этого проекта — только те, что человеку видны. Отбирает сервер. */
  channels: Conversation[];
  collapsed: boolean;
  onToggle: () => void;
  /** Завести чат ВНУТРИ этого проекта (task-035). */
  onAddChat: () => void;
  /** Закрепить папку в СВОЕЙ панели либо снять (task-038). */
  onPin: (pinned: boolean) => Promise<void>;
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
      {/* ⚠️ СТРЕЛКИ СВОРАЧИВАНИЯ НЕТ (владелец 10.09: «нужно убрать
          полностью»). Папка по-прежнему сворачивается нажатием на строку —
          исчез только значок. Признак «свёрнута» остался и он честнее
          стрелки: у свёрнутой видны числа непрочитанного, у развёрнутой —
          сами чаты. */}
      <div className="flex items-center rounded pr-1 transition-colors hover:bg-raised">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-transparent px-2 py-1.5 text-left text-aside text-muted transition-colors hover:text-ink"
        >
          {/* ⚠️ ЗАКРЕПЛЁННАЯ ПАПКА ПОКАЗЫВАЕТ БУЛАВКУ ВМЕСТО СВОЕГО ЗНАЧКА.
              Два значка подряд — это два сообщения там, где нужно одно;
              «почему она наверху» важнее, чем «про что она», пока
              название рядом. */}
          {project.pinned ? (
            <PushPin className="size-4 shrink-0 opacity-60" weight="fill" aria-hidden="true" />
          ) : (
            <ЗначокПроекта icon={project.icon} color={project.color} className="size-4" />
          )}
          <span className="truncate font-medium">{project.title}</span>
          {/* Свёрнутый говорит числами; развёрнутый молчит — числа видны
            на самих чатах, и повторять их сверху значит сказать дважды. */}
          {collapsed ? <Сводка unread={сумма(unreadOf)} mentions={сумма(mentionsOf)} /> : null}
        </button>

        {/* ⚠️ «+» СТОИТ В СТРОКЕ САМОЙ ПАПКИ, А НЕ ОТДЕЛЬНОЙ СТРОКОЙ
            ПОД ЕЁ ЧАТАМИ (владелец 10.09: «в codex кнопка + где сам
            проект, отсюда нужно убрать»). Отдельная строка занимала
            место в каждой развёрнутой папке и притворялась чатом —
            в списке из семи папок это семь ложных строк. */}
        <button
          type="button"
          aria-label={`Новый чат в проекте «${project.title}»`}
          title="Новый чат"
          onClick={onAddChat}
          className={[
            "grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted transition-opacity",
            "hover:bg-selected hover:text-ink focus-visible:opacity-100",
            "opacity-0 group-hover/project:opacity-100",
          ].join(" ")}
        >
          <Plus className="size-3.5" weight="bold" />
        </button>

        <МенюПроекта project={project} onPin={onPin} onRename={onRename} onRemove={onRemove} />
      </div>

      {/* ⚠️ У ПУСТОЙ ПАПКИ ТЕЛА НЕТ ВОВСЕ, А НЕ «ПУСТОЕ ТЕЛО». Пустой
          столбец всё равно занимает просвет между собой и заголовком —
          и папка без чатов дёргалась на каждое нажатие, будто что-то
          раскрывается (владелец увидел это на экране). Показывать
          нечего — значит и места занимать нечем. */}
      {collapsed || channels.length === 0 ? null : (
        <div className="flex flex-col gap-0.5 pl-3">
          {channels.map((channel) => renderChannel(channel))}
        </div>
      )}
    </div>
  );
}
