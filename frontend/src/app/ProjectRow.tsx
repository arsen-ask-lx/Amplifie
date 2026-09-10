import { CaretDown, CaretRight, FolderSimple } from "@phosphor-icons/react";
import type { Conversation, Project } from "../data/api.js";

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

export function ProjectRow({
  project,
  channels,
  collapsed,
  onToggle,
  unreadOf,
  mentionsOf,
  renderChannel,
}: {
  project: Project;
  /** Чаты этого проекта — только те, что человеку видны. Отбирает сервер. */
  channels: Conversation[];
  collapsed: boolean;
  onToggle: () => void;
  unreadOf: (conversationId: string) => number;
  mentionsOf: (conversationId: string) => number;
  renderChannel: (channel: Conversation) => React.ReactNode;
}) {
  const сумма = (счёт: (id: string) => number) =>
    channels.reduce((всего, one) => всего + счёт(one.id), 0);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded bg-transparent px-2 py-1.5 text-left text-aside text-muted transition-colors hover:bg-raised hover:text-ink"
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

      {collapsed ? null : (
        <div className="flex flex-col gap-0.5 pl-3">
          {channels.map((channel) => renderChannel(channel))}
          {channels.length === 0 ? (
            <p className="px-2.5 py-1.5 text-aside text-muted">Пусто. Перенесите сюда чат.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
