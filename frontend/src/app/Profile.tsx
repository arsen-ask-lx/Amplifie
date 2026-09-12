import { Gear, SignOut, UserCircle, UserPlus } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";
import type { Me } from "../data/api.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";
import { InviteDialog } from "./InviteDialog.js";

/**
 * Профиль в подвале панели: кто я, и всё, что относится ко мне.
 *
 * ЧТО БЫЛО НЕ ТАК. В подвале стояли три равновесные строки — «Тёмная тема»,
 * «Пригласить», «Выйти», — и панель заканчивалась списком несвязанных
 * действий. Настройки вида попадались на глаза чаще, чем открываются.
 *
 * ЧТО СТАЛО. Одна точка: кружок с инициалом и имя. Всё, что относится
 * к «мне», живёт под ней и открывается по нажатию.
 *
 * Выбор темы и масштаба живёт на отдельном экране: меню оставляет только
 * реальные переходы и действия, а не прячет настройку в двух вложенных списках.
 */

/** Кружок с инициалом — вместо картинки, которой у нас нет. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function Profile({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const [inviting, setInviting] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded bg-transparent px-2 py-2 text-left transition-colors outline-none hover:bg-raised focus-visible:bg-raised"
        aria-label="Профиль и настройки"
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-pill bg-accent-soft text-body font-medium text-ink-on-soft"
        >
          {initial(me.participant.displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink">{me.participant.displayName}</span>
          <span className="block truncate text-mark text-muted">{me.workspace.name}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/settings/profile">
            <UserCircle />
            Профиль
          </Link>
        </DropdownMenuItem>

        {/* ⚠️ ПРИГЛАШЕНИЕ ЖИВЁТ ЗДЕСЬ, А НЕ У КАНАЛА. Позвать в компанию
            и добавить в группу — разные действия: первое даёт человеку
            место в пространстве, второе — доступ к одному разговору.
            Слитые в одну кнопку, они однажды впустят в компанию того,
            кого звали в канал. */}
        <DropdownMenuItem onSelect={() => setInviting(true)}>
          <UserPlus />
          Пригласить в пространство
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/settings/appearance">
            <Gear />
            Настройки
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={onLeave}>
          <SignOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>

      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
    </DropdownMenu>
  );
}
