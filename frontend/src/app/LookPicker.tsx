import { PROJECT_PRESETS } from "@amplifie/contract";
import { useState } from "react";
import { iconByName, PROJECT_ICONS, ProjectGlyph } from "../shared/projectLook.js";
import { ICON_LABELS, PRESET_LABELS } from "../shared/projectLookNames.js";
import { ColorField } from "../shared/ui/color-field.js";
import { Input } from "../shared/ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/popover.js";

/**
 * Вид папки: значок и цвет — поповером у образца (task-104).
 *
 * ⚠️ ПОПОВЕР, А НЕ СТЕНА В ОКНЕ. Восемь цветов и девяносто значков занимали
 * всё окно: «мне не нравится вид данного модального окна, полностью переделай»
 * (владелец, тыкалка 17.09). Теперь в окне видно то, ради чего его открыли, —
 * имя, — а вид выбирается там, где показан его образец.
 *
 * ⚠️ ЦВЕТ ЛЮБОЙ, А НЕ ИЗ НАБОРА (отмена Р-041, его же слова: «мне нужен
 * колорпикер, а не 16 цветов»). Восемь готовых остались ради выбора в один
 * щелчок; значок на заливке красится тем, что читается, — считает `inkOn`.
 */
export function LookPicker({
  icon,
  color,
  disabled,
  onIcon,
  onColor,
}: {
  icon: string | null;
  color: string | null;
  disabled: boolean;
  onIcon: (one: string | null) => void;
  onColor: (one: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const found = PROJECT_ICONS.filter((one) =>
    ICON_LABELS[one].toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label="Значок и цвет проекта"
        title="Значок и цвет проекта"
        className="grid size-9 shrink-0 place-items-center rounded-lg border border-edge transition-colors hover:bg-raised disabled:opacity-50"
      >
        <ProjectGlyph icon={icon} color={color} className="size-5" />
      </PopoverTrigger>

      <PopoverContent className="w-72">
        <div className="flex flex-col gap-2">
          {/* ⚠️ ПОИСК ПЕРВЫМ И С ФОКУСОМ: значков девять десятков, и глазами
              их перебирают только пока не знают, что ищут. */}
          <Input
            autoFocus
            type="search"
            value={query}
            placeholder="найти значок: кран, смета, ключ"
            aria-label="Поиск значка"
            onChange={(event) => setQuery(event.target.value)}
          />

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Цвет</legend>
            {PROJECT_PRESETS.map((one) => (
              <button
                key={one}
                type="button"
                aria-label={PRESET_LABELS[one] ?? one}
                aria-pressed={color === one}
                title={PRESET_LABELS[one] ?? one}
                onClick={() => onColor(one)}
                className={[
                  "size-6 rounded-pill border-2 transition-colors",
                  color === one ? "border-ink" : "border-transparent",
                ].join(" ")}
                style={{ backgroundColor: one }}
              />
            ))}

            {/* Свой цвет — родной пипеткой браузера (`ColorField`). */}
            <ColorField value={color} label="Свой цвет" onChange={onColor} />

            <button
              type="button"
              onClick={() => onColor(null)}
              className="ml-auto rounded bg-transparent px-2 py-1 text-mark text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Без цвета
            </button>
          </fieldset>

          {/* ⚠️ ВЫСОТА ОГРАНИЧЕНА, А НЕ «СКОЛЬКО ВЫЙДЕТ» (task-038): девяносто
              значков в полный рост выталкивали кнопку сохранения за край экрана. */}
          <div className="hide-scroll grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
            {found.map((one) => {
              const Glyph = iconByName(one);
              return (
                <button
                  key={one}
                  type="button"
                  aria-label={ICON_LABELS[one]}
                  aria-pressed={icon === one}
                  title={ICON_LABELS[one]}
                  onClick={() => onIcon(icon === one ? null : one)}
                  className={[
                    "grid size-8 place-items-center rounded-lg border transition-colors",
                    icon === one
                      ? "border-accent bg-raised text-ink"
                      : "border-transparent text-muted",
                    "hover:bg-raised hover:text-ink",
                  ].join(" ")}
                >
                  <Glyph className="size-5" />
                </button>
              );
            })}
            {found.length === 0 ? (
              <p className="col-span-8 px-1 py-2 text-aside text-muted">
                Такого значка нет. Попробуйте другое слово.
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
