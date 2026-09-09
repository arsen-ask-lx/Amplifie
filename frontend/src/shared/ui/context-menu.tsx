import { CaretRight } from "@phosphor-icons/react";
import { ContextMenu as Menu } from "radix-ui";
import type * as React from "react";
import { cn } from "@/shared/utils";

/**
 * Меню по правой кнопке.
 *
 * Не из набора shadcn целиком, а те четыре части, которыми мы пользуемся:
 * корень, область, пункт и разделитель. Остальное (вложенные меню, галочки,
 * переключатели) появится, когда понадобится, — сейчас это был бы мёртвый
 * код, который никто не проверяет.
 *
 * Вид повторяет выпадающее меню профиля: одна и та же поверхность,
 * одинаковые пункты. Два меню, выглядящих по-разному, учат не доверять виду.
 */

function ContextMenu(props: React.ComponentProps<typeof Menu.Root>) {
  return <Menu.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(props: React.ComponentProps<typeof Menu.Trigger>) {
  return <Menu.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        data-slot="context-menu-content"
        /* ⚠️ БЕЗ ЭТОГО «ОТВЕТИТЬ» НЕ СТАВИТ КУРСОР В ПОЛЕ. Radix при
           закрытии возвращает фокус на то, откуда меню открыли, и делает
           это ПОСЛЕ обработчика пункта: поле ввода получало фокус
           и тут же его теряло. Человек нажимал «Ответить», начинал
           печатать — и текст уходил в никуда. Найдено владельцем дважды,
           прежде чем нашлась настоящая причина. */
        onCloseAutoFocus={(event: Event) => event.preventDefault()}
        /* ⚠️ СНИЗУ ОТСТУП БОЛЬШОЙ, И ЭТО НЕ КРАСОТА. Меню по правой
           кнопке Radix ставит СБОКУ от курсора — сторону у него менять
           нельзя, тип это прямо запрещает. Значит единственный рычаг —
           граница, до которой ему разрешено доставать. Щёлкают чаще
           всего по полю ввода, а оно у самого низа экрана: с нулевым
           отступом меню накрывало ровно то, ради чего его открыли.
           Владелец: «в тг оно чуть выше, над текстом», потом — «ещё
           выше, сильно выше».
           Пятьдесят две точки — ровно высота поля ввода. Меню низом
           встаёт у его верхнего края: над текстом, но не парит над ним.
           Сто сорок пробовали — владелец сказал «очень высоко», и был
           прав: меню уезжало в середину экрана.
           По остальным сторонам двенадцать: там прижиматься не к чему. */
        collisionPadding={{ top: 12, right: 12, left: 12, bottom: 52 }}
        className={cn(
          "z-50 min-w-[10rem] overflow-hidden rounded-md bg-popover p-1.5 text-popover-foreground shadow-menu data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          /* ⚠️ ВТОРОЙ СЛУЧАЙ, И ОТСТУП ВЫШЕ ЕГО НЕ ЛЕЧИТ. Radix выбирает
             выравнивание по месту щелчка. `start` — меню растёт вниз,
             и его держит отступ от края. `end` — меню прижато НИЗОМ
             к самому курсору, а до края ему далеко, и никакой отступ
             тут ни при чём. Замерено обоими прогонами.
             Двадцать четыре точки — столько, чтобы низ меню оказался
             там же, где в первом случае: у верхнего края поля. Сорок
             восемь пробовали, владелец сказал «очень высоко». */
          "data-[align=end]:-translate-y-6",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof Menu.Item> & { variant?: "default" | "destructive" }) {
  return (
    <Menu.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded px-2.5 py-2 text-body outline-hidden select-none focus:bg-selected focus:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Вложенное меню: «Форматирование ▸». */
function ContextMenuSub(props: React.ComponentProps<typeof Menu.Sub>) {
  return <Menu.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        "flex cursor-default items-center gap-2 rounded px-2.5 py-2 text-body outline-hidden select-none focus:bg-selected focus:text-ink data-[state=open]:bg-selected data-[state=open]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted",
        className,
      )}
      {...props}
    >
      {children}
      <CaretRight className="ml-auto size-4" />
    </Menu.SubTrigger>
  );
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-md bg-popover p-1.5 text-popover-foreground shadow-menu data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
