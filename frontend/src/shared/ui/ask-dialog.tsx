import { useState } from "react";
import { Button } from "./button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

/**
 * Два вида вопроса человеку: «точно?» и «как назвать?».
 *
 * ⚠️ ОДИН КАРКАС НА ВСЕ ОКНА-ВОПРОСЫ, И ПРИЧИНОЙ СТАЛ ГЕЙТ ПОВТОРОВ.
 * Окна удаления канала и проекта, заводки чата и проекта были собраны
 * четырьмя копиями одной разметки. Копии уже разошлись: одно окно
 * показывало отказ сервера, другое молчало, — и заметить это можно
 * было только нажав. Теперь «Отмена», занятость и отказ живут здесь.
 */

/**
 * «Точно сделать это?» — с разрушительной кнопкой.
 *
 * ⚠️ ФОКУС НА ДЕЙСТВИИ, А НЕ НА ОТМЕНЕ, И ЭТО НЕ ОПЕЧАТКА. Окно
 * открывается из меню, где человек уже выбрал действие: он пришёл
 * подтвердить, а не передумать. Отмена рядом — и мышью, и Escape.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: React.ReactNode;
  /** Что случится. Обязательно: без этого «точно?» не о чем спрашивать. */
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-96">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Отмена
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Окно-форма: поля, «Отмена» и главная кнопка.
 *
 * ⚠️ ОТКАЗ СЕРВЕРА ЛОВИТСЯ ЗДЕСЬ И ПОКАЗЫВАЕТСЯ СЛОВАМИ. Прежде одно
 * из окон отдавало его мимо `finally` необработанным обещанием: окно
 * оставалось открытым и молчало, будто кнопка не работает. Что именно
 * сказать, решает хозяин окна (`explain`) — он знает свои поля.
 *
 * ⚠️ ВСЕГДА ОТКРЫТО, КАК `ConfirmDialog` (task-103). Хозяин ставит окно
 * на страницу на время вопроса и снимает после. Прежде окно пряталось
 * свойством `open` и помнило поля между открытиями: второй «+» показывал
 * прежний проект, «Новый чат» после «Отмены» — набранное.
 */
export function FormDialog({
  title,
  submitLabel,
  canSubmit,
  onSubmit,
  explain,
  onClose,
  children,
}: {
  title: React.ReactNode;
  submitLabel: string;
  /** Можно ли жать главную кнопку — например, поле не пустое. */
  canSubmit: boolean;
  /** Сделать дело. Удалось — окно закроется само. */
  onSubmit: () => Promise<void>;
  /** Отказ человеческими словами. */
  explain: (failure: unknown) => string;
  onClose: () => void;
  /** Поля окна; `busy` — пока ждём сервер, поля не правятся. */
  children: (busy: boolean) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit();
      onClose();
    } catch (failure) {
      setProblem(explain(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-96">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-3">
            {children(busy)}

            {problem ? (
              <p role="alert" className="text-aside text-danger">
                {problem}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Отмена
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
