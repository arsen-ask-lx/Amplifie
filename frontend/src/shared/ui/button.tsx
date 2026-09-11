import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/shared/utils";

const buttonVariants = cva(
  "inline-flex w-auto shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-transparent text-body font-medium whitespace-nowrap transition-all outline-none focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:outline-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-on-accent hover:bg-accent/90",
        destructive: "bg-danger text-on-danger hover:bg-danger/90 focus-visible:outline-danger",
        outline: "border-edge bg-bg shadow-raised hover:bg-selected hover:text-ink",
        secondary: "bg-raised text-ink hover:bg-raised/80",
        ghost: "bg-transparent hover:bg-selected hover:text-ink",
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-lg px-2 text-mark has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Кнопка набора.
 *
 * ⚠️ ТИП ПО УМОЛЧАНИЮ — `button`, И ЭТО НЕ ПРИДИРКА. `<button>` внутри
 * формы по умолчанию ОТПРАВЛЯЕТ её: это поведение платформы, и помнить
 * его обязан один файл, а не каждый вызов. Пока умолчания не было,
 * «У меня уже есть вход» на экране входа переключала дверь И слала
 * пустую форму разом — человек видел ошибки полей там, где ничего
 * не отправлял. Отказ молчаливый: ни ошибки, ни следа.
 *
 * Кнопок в продукте двадцать, форм шесть — то есть мина была не одна.
 * Отправляющие объявляют `type="submit"` явно, и это правильно: отправка
 * формы — намерение, а не умолчание.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type = "button",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      // ⚠️ `asChild` подменяет узел чужим (ссылка, пункт меню), и тип
      // кнопки там не нужен вовсе — у ссылки его не бывает.
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}

export { Button };
