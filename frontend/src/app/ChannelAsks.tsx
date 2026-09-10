import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../data/api.js";
import { Button } from "../shared/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog.js";
import { Input } from "../shared/ui/input.js";

/**
 * Что панель спрашивает про КАНАЛ: как его заводят и как подтверждают
 * удаление.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `RoomList`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов по вопросу, а не по числу строк: `RoomList` отвечает на «из чего
 * состоит панель», а здесь — «о чём она спрашивает человека». Второй
 * вопрос за две задачи оброс окном заводки, окном удаления и правилом
 * про то, где живёт фокус.
 */

/** Поле нового канала: заводится на месте, в самой секции. */
export function NewChannel({
  onCreate,
  onDone,
}: {
  onCreate: (title: string) => Promise<void>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => field.current?.focus(), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="px-1 py-0.5">
      <Input
        ref={field}
        value={title}
        disabled={busy}
        placeholder="название канала"
        aria-label="Название нового канала"
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onDone()}
        // Пустое поле, потерявшее фокус, закрывается само: держать
        // на экране то, что человек уже мысленно закрыл, — мусор.
        onBlur={() => !title.trim() && onDone()}
        className="h-7 border-accent bg-card px-2"
      />
    </form>
  );
}

/**
 * Строка канала: название и три точки справа.
 *
 * ⚠️ ТРИ ТОЧКИ, А НЕ ПРАВАЯ КНОПКА. Сначала действия висели на правой
 * кнопке — как у реплики в ленте. Владелец сказал прямо: неудобно, и он
 * прав. Правая кнопка не видна: о ней надо ЗНАТЬ. В ленте это терпимо —
 * там так у Телеграма, и человек приходит с этой привычкой; в боковой
 * панели привычка другая, её задали ChatGPT и Claude, и там действия
 * живут на трёх точках.
 *
 * ⚠️ ТОЧКИ ПОЯВЛЯЮТСЯ ПО НАВЕДЕНИЮ, но остаются видимыми, пока меню
 * открыто или на них фокус. Иначе меню открывалось бы и тут же теряло
 * свою кнопку, а с клавиатуры до неё было бы не добраться вовсе.
 *
 * ⚠️ ДВЕ КНОПКИ РЯДОМ, А НЕ КНОПКА В КНОПКЕ. Вложенная кнопка — неверная
 * разметка: браузер её распрямляет, и нажатие на точки выбирало бы канал
 * заодно.
 */

/**
 * «Точно удалить канал?» — своим окном, а не `window.confirm`.
 *
 * Родное окно браузера рисуется поверх страницы чужим видом, не знает
 * наших тем и на Windows выглядит как ошибка системы, а не как вопрос
 * приложения. Здесь тот же вид, что и у остального.
 */
export function ConfirmRemoval({
  channel,
  onCancel,
  onConfirm,
}: {
  channel: Conversation | null;
  onCancel: () => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  if (!channel) return null;
  return (
    // Общее окно, а не свой `div role="dialog"`: ловушка фокуса, Escape
    // и блокировка прокрутки фона живут в одном месте (`ui/dialog.tsx`).
    <Dialog open onOpenChange={(открыто) => !открыто && onCancel()}>
      <DialogContent className="sm:max-w-96">
        <DialogHeader>
          <DialogTitle>Удалить «{channel.title}»?</DialogTitle>
          <DialogDescription>
            Канал исчезнет у всех, кто его видит, вместе со всей перепиской. Вернуть его из
            приложения будет нельзя.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Отмена
            </Button>
          </DialogClose>
          {/* ⚠️ ФОКУС НА «УДАЛИТЬ», И ЭТО НЕ ОПЕЧАТКА. Окно открывается
              из меню, где человек уже выбрал «удалить канал»: он пришёл
              сюда подтвердить, а не передумать. Отмена рядом и достижима
              и мышью, и Escape. */}
          <Button
            type="button"
            variant="destructive"
            autoFocus
            onClick={() => void onConfirm(channel.id)}
          >
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
