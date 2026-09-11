import type * as React from "react";
import { cn } from "@/shared/utils";

/**
 * ⚠️ ОБВОДКА ФОКУСА ЧЁТКАЯ, А НЕ СВЕТЯЩАЯСЯ, И ЭТО ИСПРАВЛЕНИЕ ЧУЖОГО
 * УМОЛЧАНИЯ. Набор компонентов (Р-018) приносит с собой мягкое свечение
 * в три пикселя акцентом с прозрачностью 20%. Владелец назвал его
 * ужасным, и он прав не только на вкус: 20% акцента на фоне дают около
 * 2:1 при требуемых WCAG трёх для границ управляемых элементов, —
 * то есть фокус на обычном мониторе просто не виден. Прозрачность и была
 * причиной, по которой наш гейт контраста молчал: он сравнивает цвета,
 * а не смесь с фоном.
 *
 * Взято готовое, а не придумано: так делает GitHub Primer — сплошная
 * обводка со смещением внутрь вместо тени. Смещение на пиксель кладёт
 * её ровно на границу поля, поэтому соседние строки не сдвигаются.
 * Пара «акцент на карточке» теперь стоит в гейте контраста.
 */
/**
 * Однострочное поле — одно на всё приложение.
 *
 * Заливка поля — `bg-bg`, как и записано у третьей ступени в
 * `styles.css`. Карточка остаётся поверхностью, а поле внутри неё —
 * местом действия; белое поле на белой карточке стирало эту разницу.
 *
 * Размер и внешний радиус те же, что у Select и Button: 36 и 18 px.
 * Локальные случаи меняют только действительно особое — компактную
 * высоту, дополнительный внутренний отступ или read-only состояние.
 */
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-edge bg-bg px-3 text-body text-ink outline-none placeholder:text-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:outline-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
