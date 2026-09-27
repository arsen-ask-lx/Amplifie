import { Check, Palette } from "@phosphor-icons/react";
import { useState } from "react";
import { apply, chosen, remember, THEMES, type Theme } from "../shared/theme.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";

const GROUPS = [
  { tone: "light", label: "Светлые" },
  { tone: "dark", label: "Тёмные" },
] as const;

/** Быстрый личный выбор оформления без ухода из текущего разговора. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(chosen);

  function pick(next: Theme) {
    setTheme(next);
    remember(next);
    apply(next);
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Выбрать тему"
        className="grid size-9 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors outline-none hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
      >
        <Palette className="size-[18px]" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        {GROUPS.map(({ tone, label }) => (
          <div key={tone}>
            {tone === "dark" ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {THEMES.filter((candidate) => candidate.tone === tone).map((candidate) => (
              <ThemeItem
                key={candidate.id}
                candidate={candidate}
                selected={theme === candidate.id}
                onPick={pick}
              />
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItem({
  candidate,
  selected,
  onPick,
}: {
  candidate: (typeof THEMES)[number];
  selected: boolean;
  onPick: (theme: Theme) => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onPick(candidate.id);
      }}
    >
      <span
        aria-hidden="true"
        data-theme={candidate.id}
        className="size-3 shrink-0 rounded-pill bg-accent"
      />
      <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
      {selected ? <Check className="size-4 text-accent" aria-label="Выбрана" /> : null}
    </DropdownMenuItem>
  );
}
