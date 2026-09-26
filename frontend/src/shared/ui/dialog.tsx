import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/shared/utils";
import { claimFocus } from "./focusAfterClose.js";

/**
 * Модальное окно — ОДНО на всё приложение.
 *
 * ⚠️ ЧУЖИЕ ИМЕНА ЦВЕТОВ И РАЗМЕРОВ ПЕРЕПИСАНЫ НА НАШИ, а не подставлены
 * псевдонимами. Скопированный из набора исходник был окрашен в
 * `bg-background`, `text-muted-foreground`, `text-sm`, `shadow-lg`.
 * Из них:
 *   • `bg-background` — это фон СТРАНИЦЫ, а всплывающая поверхность
 *     у нас всегда `bg-card` (Р-014: три слоя, карточка самая светлая);
 *   • `text-muted-foreground` у нас НЕ СУЩЕСТВУЕТ ВОВСЕ — подпись
 *     осталась бы цвета основного текста, и никто бы не заметил;
 *   • `text-sm`/`text-lg` минуют шкалу набора (task-013), ради которой
 *     девять размеров и сводили к пяти.
 * Правило переписывать, а не переводить, записано в `styles.css`
 * там же, где живёт словарь набора.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННЫЙ СПОСОБ СДЕЛАТЬ МОДАЛЬНОЕ ОКНО. Самодельные
 * `<div role="dialog">` были и переведены сюда: у них не было ни ловушки
 * фокуса, ни Escape, ни блокировки прокрутки фона — то есть с клавиатуры
 * из окна можно было уйти в страницу под ним, а страница ехала под
 * пальцем. Второй способ делать окно однажды разойдётся с первым.
 */

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Содержимое окна.
 *
 * ⚠️ КРЕСТИКА ЗДЕСЬ НЕТ И НЕ БУДЕТ — ПРАВИЛО ПРОЕКТА (владелец, 09.09).
 * Набор рисует его по умолчанию; строки удалены, а не спрятаны за
 * настройкой: настройка со значением «показывать» однажды окажется
 * включённой, и крестик вернётся сам.
 *
 * Закрывается окно тремя способами и без него: Escape, щелчок мимо
 * и кнопка внутри содержимого, названная словом.
 */
function DialogContent({
  className,
  children,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-6 rounded-xl border border-line bg-card p-6 shadow-float duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className,
        )}
        {...props}
        // Кто-то ждал фокус после закрытия (новый чат ставит курсор в поле) —
        // отдаём ему, а не кнопке, открывшей окно. Иначе — как у Radix.
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented && claimFocus()) event.preventDefault();
        }}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

/**
 * Низ окна.
 *
 * Готовая кнопка «Close» из набора удалена вместе с крестиком: она
 * английская, а закрывающее действие в нашем продукте называется своим
 * словом и ставится хозяином окна — «Готово», «Закрыть», «Отмена».
 */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-head leading-tight font-semibold text-ink", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-body leading-relaxed text-muted", className)}
      {...props}
    />
  );
}

/**
 * ⚠️ НАРУЖУ — ТОЛЬКО ТО, ЧЕМ ПОЛЬЗУЮТСЯ. `DialogPortal` и `DialogOverlay`
 * остались внутренними: их зовёт `DialogContent`, и снаружи они нужны
 * лишь тому, кто собирает окно по частям, — а такого у нас нет и не
 * планируется. `DialogTrigger` удалён совсем: наши окна открываются
 * состоянием (`open={…}`), а не кнопкой-открывашкой, и обёртка над
 * чужой кнопкой-открывашкой не понадобилась ни разу.
 *
 * Экспорт «на всякий случай» — это мёртвый код, который гейт находит,
 * а человек читает как «так задумано».
 */
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};
