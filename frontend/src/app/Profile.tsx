import { Check, Palette, SignOut } from "@phosphor-icons/react";
import { useState } from "react";
import type { Me } from "../data/api.js";
import { apply, chosen, remember, THEMES, type Theme } from "../shared/theme.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";

/**
 * Профиль в подвале панели: кто я, и всё, что относится ко мне.
 *
 * ЧТО БЫЛО НЕ ТАК. В подвале стояли три равновесные строки — «Тёмная тема»,
 * «Пригласить», «Выйти», — и панель заканчивалась списком несвязанных
 * действий. Смена темы попадалась на глаза чаще, чем открывается.
 *
 * ЧТО СТАЛО. Одна точка: кружок с инициалом и имя. Всё, что относится
 * к «мне», живёт под ней и открывается по нажатию.
 *
 * ⚠️ ОДИН СПИСОК ТЕМ ВМЕСТО ДВУХ ПЕРЕКЛЮЧАТЕЛЕЙ. Было «светлая/тёмная»
 * плюс семь цветов акцента — четырнадцать состояний, ни одно из которых
 * человек не назвал бы словом. Стало четырнадцать тем с именами; светлота
 * и оттенок в имени уже есть (владелец, 2026-09-08).
 *
 * ⚠️ ВЫБОР НЕ ЗАКРЫВАЕТ МЕНЮ (`preventDefault`). Тему подбирают
 * сравнением: нажал — увидел — нажал соседнюю.
 */

/** Кружок с инициалом — вместо картинки, которой у нас нет. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Список тем.
 *
 * ⚠️ КРУЖОК СЛЕВА ОБЪЯВЛЯЕТ СВОЮ ТЕМУ АТРИБУТОМ И КРАСИТСЯ ЕЮ ЖЕ.
 * Значения тем лежат в CSS и только там; держать рядом со списком вторую
 * копию цветов значило бы завести источник правды, который однажды
 * разойдётся с первым. Тот же приём, что был у образцов палитры.
 */
function Themes({ value, onPick }: { value: Theme; onPick: (theme: Theme) => void }) {
  return (
    <>
      {THEMES.map((theme) => (
        <DropdownMenuItem
          key={theme.id}
          onSelect={(event: Event) => {
            event.preventDefault();
            onPick(theme.id);
          }}
        >
          <span data-theme={theme.id} className="swatch size-4 shrink-0" aria-hidden="true" />
          {theme.label}
          {value === theme.id ? <Check className="ml-auto" /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function Profile({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const [theme, setTheme] = useState<Theme>(chosen);

  function pick(picked: Theme) {
    setTheme(picked);
    remember(picked);
    apply(picked);
  }

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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            Оформление
          </DropdownMenuSubTrigger>

          <DropdownMenuSubContent className="max-h-96 w-56 overflow-y-auto">
            <DropdownMenuLabel className="text-muted">Тема</DropdownMenuLabel>
            <Themes value={theme} onPick={pick} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={onLeave}>
          <SignOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
