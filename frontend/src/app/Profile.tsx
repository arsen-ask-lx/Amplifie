import { Check, LogOut, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import type { Me } from "../data/api.js";
import {
  ACCENTS,
  type Accent,
  apply,
  applyAccent,
  type Choice,
  chosen,
  chosenAccent,
  remember,
  rememberAccent,
} from "../shared/theme.js";
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
 * действий. Смена темы попадалась на глаза чаще, чем открывается, а выход
 * стоял рядом с ней и читался так же буднично.
 *
 * ЧТО СТАЛО. Одна точка: кружок с инициалом и имя. Всё, что относится
 * к «мне», живёт под ней и открывается по нажатию.
 *
 * ⚠️ ВИД УБРАН ВО ВЛОЖЕННОЕ МЕНЮ, А НЕ ВЫЛОЖЕН СПИСКОМ. Тема и шесть
 * цветов — восемь строк на настройку, которую трогают раз в месяц; рядом
 * с ними выход перестаёт быть заметным. Теперь это одна строка со значком
 * палитры, а выбор открывается по ней.
 *
 * ⚠️ ВЫБОР НЕ ЗАКРЫВАЕТ МЕНЮ (`preventDefault`). Цвет и тему подбирают
 * сравнением: нажал — увидел — нажал соседний. Меню, закрывающееся после
 * каждого нажатия, превращает подбор в шесть заходов.
 */

const THEMES: Array<{ id: Choice; label: string; Icon: typeof Sun }> = [
  { id: "светлая", label: "Светлая", Icon: Sun },
  { id: "тёмная", label: "Тёмная", Icon: Moon },
];

/** Кружок с инициалом — вместо картинки, которой у нас нет. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * Образцы цвета.
 *
 * Цвет кружок получает из атрибута `data-accent` на самом себе: в
 * `styles.css` шкала объявлена без `:root`, поэтому её получает любой узел
 * с атрибутом. Иначе рядом с палитрой пришлось бы держать вторую копию
 * шести цветов — и она разошлась бы с первой при первой же правке.
 *
 * ⚠️ ЗАЛИВКА КЛАССОМ `.swatch`, А НЕ УТИЛИТОЙ `bg-accent`. Почему именно
 * так — подробно в `styles.css` у самого класса; коротко: роль `--accent`
 * считается на корне и приезжает сюда уже готовым цветом, отчего все шесть
 * кружков выходили одинаковыми.
 */
function Swatches({ value, onPick }: { value: Accent; onPick: (accent: Accent) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
      {ACCENTS.map((accent) => (
        <DropdownMenuItem
          key={accent}
          data-accent={accent}
          aria-label={accent}
          title={accent}
          onSelect={(event: Event) => {
            event.preventDefault();
            onPick(accent);
          }}
          className={[
            "swatch size-6 shrink-0 p-0",
            // Выбранный — обведён, а не помечен галочкой внутри. Галочка
            // обязана быть либо белой, либо тёмной, а шесть цветов дают
            // и светлые, и тёмные заливки: на янтарном белая пропадала.
            // Кольцо читается на любом.
            value === accent ? "ring-2 ring-ink ring-offset-2 ring-offset-popover" : "",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

export function Profile({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const [choice, setChoice] = useState<Choice>(chosen);
  const [accent, setAccent] = useState<Accent>(chosenAccent);

  function pickTheme(picked: Choice) {
    setChoice(picked);
    remember(picked);
    apply(picked);
  }

  function pickAccent(picked: Accent) {
    setAccent(picked);
    rememberAccent(picked);
    applyAccent(picked);
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

          <DropdownMenuSubContent className="w-56">
            <DropdownMenuLabel className="text-muted">Тема</DropdownMenuLabel>
            {THEMES.map(({ id, label, Icon }) => (
              <DropdownMenuItem
                key={id}
                onSelect={(event: Event) => {
                  event.preventDefault();
                  pickTheme(id);
                }}
              >
                <Icon />
                {label}
                {/* Галочка отвечает на вопрос «а что сейчас». Кнопка
                    по кругу отвечала на него словом и всё равно требовала
                    догадки о следующем нажатии. */}
                {choice === id ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuLabel className="text-muted">Цвет</DropdownMenuLabel>
            <Swatches value={accent} onPick={pickAccent} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={onLeave}>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
