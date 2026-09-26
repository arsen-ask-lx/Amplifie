import { MagnifyingGlass } from "@phosphor-icons/react";
import type * as React from "react";

/**
 * Строка команды — второе поле продукта, рядом с полем формы (`input.tsx`).
 *
 * ⚠️ ДВА ВИДА ПОЛЕЙ, И ЭТО НЕ НЕДОСМОТР. Поле формы — рамка, 36 px, своя
 * подпись: оно стоит в ряду других полей, и человек видит его границы.
 * Строка команды живёт в полосе окна поиска: у неё нет рамки, зато есть
 * лупа и линия под полосой — так устроены Spotlight, Telegram и командная
 * строка VS Code. Сделай её полем формы — окно поиска станет формой
 * с одним полем, а это другой предмет.
 *
 * ⚠️ ОБЩИЙ КОМПОНЕНТ, А НЕ РАЗМЕТКА В ОКНЕ (task-105). Своя разметка жила
 * в `SearchDialog` — единственное поле продукта мимо общего набора. Второе
 * такое место (поиск по чату) уже в очереди, и разъехались бы они молча.
 */
export function CommandField({
  value,
  label,
  placeholder,
  onChange,
  onKeyDown,
  lined = true,
}: {
  value: string;
  /** Имя поля словами: окно открывают сочетанием, подписи на экране нет. */
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /**
   * Своя линия под полем. Встроенное в полосу поле (поиск в чате) её не
   * рисует: линию ведёт полоса во всю ширину, под стрелками и крестиком тоже,
   * — иначе под полем их было две, а дальше одна (владелец 26.09).
   */
  lined?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 px-4 py-3 ${lined ? "border-b border-line" : ""}`}>
      <MagnifyingGlass className="size-5 shrink-0 text-muted" aria-hidden="true" />
      <input
        type="search"
        // biome-ignore lint/a11y/noAutofocus: окно открыто сочетанием ради набора — фокус и есть его назначение
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
      />
    </label>
  );
}
