import { useState } from "react";
import type { Conversation } from "../data/api.js";
import { statusOf } from "../shared/failure.js";
import { ConfirmDialog, FormDialog } from "../shared/ui/ask-dialog.js";
import { Input } from "../shared/ui/input.js";

/**
 * Что панель спрашивает про ЧАТ: как его заводят и как подтверждают
 * удаление.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `RoomList`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов по вопросу, а не по числу строк: `RoomList` отвечает на «из чего
 * состоит панель», а здесь — «о чём она спрашивает человека».
 */

/**
 * Окно нового чата: спрашивает название и заводит.
 *
 * ⚠️ ОКНО, А НЕ СТРОКА-ПОЛЕ В СПИСКЕ, И ЭТО ЗАМЕНА ТОГО, ЧТО БЫЛО.
 * Поле жило прямо в панели, но кнопка «Новый чат» переехала в верхний
 * блок разделов (как в Codex — замечание владельца 10.09), а верхний
 * блок про список ничего не знает и знать не должен. Окно рвёт эту
 * связь: заводить чат можно откуда угодно.
 *
 * ⚠️ ОДНО ОКНО НА ОБА СЛУЧАЯ — сверху и внутри папки. Разница только
 * в том, известна ли папка заранее; двумя окнами они разъехались бы.
 */
export function NewChatDialog({
  /** Название папки, если чат заводят внутри неё. Для заголовка окна. */
  folderTitle,
  onCreate,
  onClose,
}: {
  folderTitle?: string | undefined;
  onCreate: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  // Поле рождается с окном и умирает с ним: окно на странице только
  // на время вопроса (task-103), обнулять руками нечего.
  const [title, setTitle] = useState("");

  return (
    <FormDialog
      title={folderTitle ? `Новый чат в проекте «${folderTitle}»` : "Новый чат"}
      submitLabel="Завести"
      canSubmit={title.trim() !== ""}
      onSubmit={() => onCreate(title.trim())}
      explain={(failure) =>
        statusOf(failure) === null
          ? "Сервер не ответил. Проверьте связь и повторите."
          : "Не получилось завести чат. Повторите ещё раз."
      }
      onClose={onClose}
    >
      {(busy) => (
        <Input
          autoFocus
          value={title}
          disabled={busy}
          maxLength={120}
          placeholder="например, Смета"
          aria-label="Название нового чата"
          onChange={(event) => setTitle(event.target.value)}
        />
      )}
    </FormDialog>
  );
}

/**
 * «Точно удалить чат?» — своим окном, а не `window.confirm`.
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
    <ConfirmDialog
      title={`Удалить «${channel.title}»?`}
      description="Чат исчезнет у всех, кто его видит, вместе со всей перепиской. Вернуть его из приложения будет нельзя."
      confirmLabel="Удалить"
      onConfirm={() => void onConfirm(channel.id)}
      onCancel={onCancel}
    />
  );
}
