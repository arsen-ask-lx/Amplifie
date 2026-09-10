import { useState } from "react";
import { Button } from "../shared/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog.js";
import { Input } from "../shared/ui/input.js";

/**
 * Название проекта: завести новый либо переименовать.
 *
 * ⚠️ СВОЁ ОКНО, А НЕ `window.prompt`, И ЭТО ЗАМЕНА ТОГО, ЧТО БЫЛО.
 * Браузерное окно рисуется поверх страницы чужим видом: другой шрифт,
 * другие кнопки, другой язык, и на Windows оно читается как ошибка
 * системы, а не как вопрос приложения. Тот же довод, по которому у нас
 * своё «точно удалить канал?».
 *
 * ⚠️ ОДНО ОКНО НА ДВА СЛУЧАЯ, А НЕ ДВА ПОХОЖИХ. Завести и переименовать
 * спрашивают одно и то же — название, — и различаются заголовком
 * и кнопкой. Двумя окнами они разъехались бы: у одного появилась бы
 * проверка длины, у другого нет.
 */
export function ProjectDialog({
  open,
  title,
  было,
  кнопка,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** Заголовок окна: «Новый проект» либо «Переименовать проект». */
  title: string;
  /** Прежнее название. Пусто — заводим новый. */
  было?: string;
  кнопка: string;
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [имя, setИмя] = useState(было ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = имя.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onSubmit(name);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(открыто) => !открыто && onClose()}>
      <DialogContent className="sm:max-w-96">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <Input
            autoFocus
            value={имя}
            disabled={busy}
            maxLength={120}
            placeholder="например, Объект на Ленина"
            aria-label="Название проекта"
            onChange={(event) => setИмя(event.target.value)}
            className="my-4"
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Отмена
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !имя.trim()}>
              {кнопка}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Точно убрать проект?»
 *
 * ⚠️ В ВОПРОСЕ СКАЗАНО, ЧТО ЧАТЫ ОСТАНУТСЯ, И ЭТО ГЛАВНОЕ В НЁМ. Слово
 * «убрать» рядом со словом «проект» человек прочтёт как «удалить всё,
 * что внутри» — так устроены папки везде, где он их видел. Если не
 * сказать обратное прямо здесь, он не нажмёт вовсе либо нажмёт и будет
 * искать пропавшую переписку.
 */
export function ConfirmProjectRemoval({
  title,
  onConfirm,
  onCancel,
}: {
  /** Название убираемого проекта. `null` — окно закрыто. */
  title: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  if (title === null) return null;
  return (
    <Dialog open onOpenChange={(открыто) => !открыто && onCancel()}>
      <DialogContent className="sm:max-w-96">
        <DialogHeader>
          <DialogTitle>Убрать проект «{title}»?</DialogTitle>
        </DialogHeader>
        <p className="my-4 text-body text-muted">
          Исчезнет только папка — чаты останутся и вернутся к каналам вне проектов. Переписка не
          пропадёт.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Отмена
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" autoFocus onClick={() => void onConfirm()}>
            Убрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
