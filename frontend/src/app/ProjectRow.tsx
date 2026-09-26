import { Gear, Plus, PushPin, PushPinSlash, Sliders } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../data/api.js";
import type { PanelProject } from "../data/useRooms.js";
import { ProjectGlyph } from "../shared/projectLook.js";
import { ContextMenu, ContextMenuTrigger } from "../shared/ui/context-menu.js";
import { DropdownMenu, DropdownMenuTrigger } from "../shared/ui/dropdown-menu.js";
import { contextKit, dropdownKit, type MenuKit } from "../shared/ui/menuKit.js";

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
function Summary({ unread, mentions }: { unread: number; mentions: number }) {
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
 * Меню проекта: только действия, которые уже существуют в продукте.
 *
 * ⚠️ ПРАВОЙ КНОПКОЙ, КАК У ЧАТА (владелец 17.09, task-102), И ЗНАЧКОМ
 * НАСТРОЕК ПОСЛЕ ПЛЮСА (владелец 26.09). Оба пути открывают одно меню —
 * иначе человеку пришлось бы помнить, где какие действия.
 */
function ProjectMenu({
  kit: { Content, Item, Separator },
  project,
  onPin,
  onRename,
  onRemove,
}: {
  kit: MenuKit;
  project: PanelProject;
  onPin: (pinned: boolean) => Promise<void>;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <Content className="w-52">
      <Item onSelect={() => void onPin(!project.pinned)}>
        {project.pinned ? <PushPinSlash /> : <PushPin />}
        {project.pinned ? "Открепить" : "Закрепить"}
      </Item>
      <Separator />
      <Item onSelect={onRename}>
        <Gear />
        Редактировать проект
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={onRemove}>
        Убрать проект
      </Item>
    </Content>
  );
}

export function ProjectRow({
  project,
  channels,
  collapsed,
  onToggle,
  onAddChannel,
  onPin,
  onRename,
  onRemove,
  more,
  onMore,
  renderChannel,
}: {
  project: PanelProject;
  /** Чаты этого проекта — только те, что человеку видны. Отбирает сервер. */
  channels: Conversation[];
  collapsed: boolean;
  onToggle: () => void;
  onAddChannel: () => void;
  /** Закрепить папку в СВОЕЙ панели либо снять (task-038). */
  onPin: (pinned: boolean) => Promise<void>;
  onRename: () => void;
  onRemove: () => void;
  /** Есть ли в папке чаты ниже загруженных — тогда рисуем «Показать ещё». */
  more: boolean;
  onMore: () => void;
  renderChannel: (channel: Conversation) => React.ReactNode;
}) {
  // Тело остаётся в потоке лишь на время закрытия. Открытию не нужна
  // вторая React-фаза: первый кадр задаёт CSS `@starting-style`.
  const [bodyInFlow, setBodyInFlow] = useState(!collapsed);
  const menu = { project, onPin, onRename, onRemove };
  const body = useRef<HTMLDivElement>(null);

  /**
   * ⚠️ ЗАКРЫТИЕ БЕЗ ДВИЖЕНИЯ КОНЦА ПЕРЕХОДА НЕ ДАЁТ, И ТЕЛО ОСТАВАЛОСЬ.
   * `transitionend` приходит, только если переход был: при запрете анимации
   * его нет вовсе, а свёрнутый в первом же кадре не успевает начать. Замер
   * 11.09: 100 свёрнутых проектов держали на странице 51 600 невидимых
   * элементов, и каждое сообщение перерисовывало их почти секунду.
   * Нечему двигаться — тело уходит сразу; есть чему — ждём конца перехода.
   */
  useEffect(() => {
    if (!collapsed) {
      setBodyInFlow(true);
      return;
    }
    const moving = body.current?.getAnimations().some((one) => one.playState === "running");
    if (!moving) setBodyInFlow(false);
  }, [collapsed]);

  return (
    <div className="flex flex-col gap-0.5">
      {/* ⚠️ СТРЕЛКИ СВОРАЧИВАНИЯ НЕТ (владелец 10.09: «нужно убрать
          полностью»). Папка по-прежнему сворачивается нажатием на строку —
          исчез только значок. Признак «свёрнута» остался и он честнее
          стрелки: у свёрнутой видны числа непрочитанного, у развёрнутой —
          сами чаты. */}
      {/* ⚠️ ОБЛАСТЬ МЕНЮ — ТОЛЬКО ЗАГОЛОВОК ПАПКИ. Чаты внутри — снаружи неё:
          иначе правая кнопка по чату открыла бы меню проекта. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/project flex items-center rounded pr-1 transition-colors hover:bg-raised">
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={onToggle}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-transparent px-2 py-1.5 text-left text-body text-muted transition-colors hover:text-ink"
            >
              <ProjectGlyph icon={project.icon} color={project.color} className="size-4" />
              <span className="truncate font-medium">{project.title}</span>
              {/* Свёрнутый говорит числами; развёрнутый молчит — числа видны
                на самих чатах, и повторять их сверху значит сказать дважды. */}
              {collapsed ? <Summary unread={project.unread} mentions={project.mentions} /> : null}
            </button>

            <button
              type="button"
              aria-label={`Новый чат в проекте «${project.title}»`}
              onClick={onAddChannel}
              className="grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted opacity-0 transition-opacity hover:bg-selected hover:text-ink focus-visible:opacity-100 group-hover/project:opacity-100"
            >
              <Plus className="size-3.5" weight="bold" />
            </button>
            <DropdownMenu>
              {/* Как плюс: виден при наведении и фокусе; открытое меню его держит. */}
              <DropdownMenuTrigger
                aria-label={`Настройки проекта «${project.title}»`}
                className="grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted opacity-0 transition-opacity hover:bg-selected hover:text-ink focus-visible:opacity-100 group-hover/project:opacity-100 data-[state=open]:opacity-100"
              >
                <Sliders className="size-3.5" weight="bold" />
              </DropdownMenuTrigger>
              <ProjectMenu kit={dropdownKit} {...menu} />
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ProjectMenu kit={contextKit} {...menu} />
      </ContextMenu>

      {/* ⚠️ У ПУСТОЙ ПАПКИ ТЕЛА НЕТ ВОВСЕ, А НЕ «ПУСТОЕ ТЕЛО». Пустой
          столбец всё равно занимает просвет между собой и заголовком —
          и папка без чатов дёргалась на каждое нажатие, будто что-то
          раскрывается (владелец увидел это на экране). Показывать
          нечего — значит и места занимать нечем. */}
      {(channels.length === 0 && !more) || !bodyInFlow ? null : (
        <div
          ref={body}
          aria-hidden={collapsed}
          data-slot="project-chats"
          data-state={collapsed ? "closed" : "open"}
          onTransitionEnd={(event) => {
            if (
              collapsed &&
              event.target === event.currentTarget &&
              event.propertyName === "grid-template-rows"
            ) {
              setBodyInFlow(false);
            }
          }}
          className="project-chats"
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-0.5 pl-3">
              {channels.map((channel) => renderChannel(channel))}
              {/* ⚠️ ЯВНАЯ СТРОКА, А НЕ ДОГРУЗКА ПО ПРОКРУТКЕ (Р-037). Папка
                  живёт внутри общего списка: подгружай она себя сама,
                  человек, листающий панель мимо, тянул бы за собой сотню
                  чатов чужого проекта. */}
              {more ? (
                <button
                  type="button"
                  onClick={onMore}
                  className="rounded bg-transparent px-2.5 py-1.5 text-left text-aside text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  Показать ещё
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
