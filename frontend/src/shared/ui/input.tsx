import type * as React from "react";
import { cn } from "@/shared/utils";

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
        "h-9 w-full min-w-0 rounded-lg border border-edge bg-bg px-3 text-body text-ink outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
