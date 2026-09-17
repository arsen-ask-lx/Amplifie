import { Popover as Layer } from "radix-ui";
import type * as React from "react";
import { cn } from "@/shared/utils";

/**
 * Слой у кнопки: поповер.
 *
 * ⚠️ ЧЕТВЁРТЫЙ СЛОЙ, А НЕ ПЯТЫЙ СПОСОБ ЕГО СДЕЛАТЬ. У нас уже есть окно
 * (`dialog`), выпадающее меню и меню по правой кнопке — все из `radix-ui`,
 * и все одной поверхностью `bg-popover` с одной тенью. Поповер отличается
 * от меню ровно одним: внутри него не пункты, а содержимое — поле поиска,
 * ряд цветов, сетка значков. Меню такого не умеет: оно ведёт стрелками
 * по пунктам и закрывается на первом же щелчке.
 *
 * ⚠️ РАБОТАЕТ ВНУТРИ ОКНА. Поповер уходит порталом наружу, но остаётся
 * в дереве фокуса окна: Radix закрывает по Escape только верхний слой,
 * поэтому Escape в поповере не роняет всё окно целиком.
 */
function Popover(props: React.ComponentProps<typeof Layer.Root>) {
  return <Layer.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof Layer.Trigger>) {
  return <Layer.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof Layer.Content>) {
  return (
    <Layer.Portal>
      <Layer.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 rounded-md bg-popover p-2 text-popover-foreground shadow-menu outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </Layer.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
