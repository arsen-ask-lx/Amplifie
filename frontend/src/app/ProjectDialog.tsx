import { useState } from "react";
import type { Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { fieldsOf, statusOf } from "../shared/failure.js";
import { ConfirmDialog, FormDialog } from "../shared/ui/ask-dialog.js";
import { Input } from "../shared/ui/input.js";
import { LookPicker } from "./LookPicker.js";

/**
 * Отказ сервера человеческими словами.
 *
 * ⚠️ ПОДРОБНОСТЬ РАЗБОРА ЧЕЛОВЕКУ НЕ ПОКАЗЫВАЕМ. «Invalid option:
 * expected one of folder|briefcase|…» — сообщение для того, кто писал
 * код; в окне оно только пугает. Человеку нужно знать: не вышло —
 * и почему, его словами.
 */
function explain(failure: unknown): string {
  const fields = fieldsOf(failure);
  if (fields.title) return "Название не подошло: слишком длинное или пустое.";
  if (fields.icon || fields.color) {
    return "Такой значок или цвет сервер не принял — обновите страницу и выберите заново.";
  }
  return statusOf(failure) === null
    ? "Сервер не ответил. Проверьте связь и повторите."
    : "Не получилось сохранить. Повторите ещё раз.";
}

/**
 * Название и вид проекта: завести новый либо переименовать.
 *
 * ⚠️ СВОЁ ОКНО, А НЕ `window.prompt`, И ЭТО ЗАМЕНА ТОГО, ЧТО БЫЛО.
 * Браузерное окно рисуется поверх страницы чужим видом: другой шрифт,
 * другие кнопки, другой язык, и на Windows оно читается как ошибка
 * системы, а не как вопрос приложения.
 *
 * ⚠️ ОДНО ОКНО НА ДВА СЛУЧАЯ, А НЕ ДВА ПОХОЖИХ. Завести и переименовать
 * спрашивают одно и то же и различаются заголовком и кнопкой. Двумя
 * окнами они разъехались бы: у одного появилась бы проверка длины,
 * у другого нет.
 */
function ProjectDialog({
  title,
  before,
  lookBefore,
  submitLabel,
  onSubmit,
  onClose,
}: {
  /** Заголовок окна: «Новый проект» либо «Редактировать проект». */
  title: string;
  /** Прежнее название. Пусто — заводим новый. */
  before?: string;
  /** Прежний вид папки. Пусто — вид по умолчанию. */
  lookBefore?: { icon?: string | null; color?: string | null } | undefined;
  submitLabel: string;
  onSubmit: (edit: { title: string; icon: string | null; color: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(before ?? "");
  const [icon, setIcon] = useState<string | null>(lookBefore?.icon ?? null);
  const [color, setColor] = useState<string | null>(lookBefore?.color ?? null);

  return (
    <FormDialog
      title={title}
      submitLabel={submitLabel}
      canSubmit={name.trim() !== ""}
      onSubmit={() => onSubmit({ title: name.trim(), icon, color })}
      explain={explain}
      onClose={onClose}
    >
      {(busy) => (
        // ⚠️ В ОКНЕ ТОЛЬКО ИМЯ И ОБРАЗЕЦ (task-104). Выбор вида уехал
        // в поповер: стена из цветов и значков была тем, что владелец
        // попросил «полностью переделать».
        <div className="flex items-center gap-2">
          <LookPicker
            icon={icon}
            color={color}
            disabled={busy}
            onIcon={setIcon}
            onColor={setColor}
          />
          <Input
            autoFocus
            value={name}
            disabled={busy}
            maxLength={120}
            placeholder="например, Объект на Ленина"
            aria-label="Название проекта"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}
    </FormDialog>
  );
}

/**
 * Все вопросы про папку одним узлом: завести, переименовать, убрать.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `RoomList`, КОГДА ГЕЙТ СЛОЖНОСТИ ПОКАЗАЛ НА НЕЁ ПАЛЬЦЕМ.
 * Шов по вопросу, а не по числу ветвлений: панель отвечает на «из чего
 * она состоит», а это — «о чём она спрашивает про папку».
 *
 * ⚠️ В ВОПРОСЕ «УБРАТЬ» СКАЗАНО, ЧТО ЧАТЫ ОСТАНУТСЯ, И ЭТО ГЛАВНОЕ В НЁМ.
 * Слово «убрать» рядом со словом «проект» человек прочтёт как «удалить
 * всё, что внутри» — так устроены папки везде, где он их видел.
 */
export function ProjectAsks({
  asking,
  panel,
  onClose,
}: {
  asking:
    | { kind: "create" }
    | { kind: "rename"; project: Project }
    | { kind: "remove"; project: Project }
    | null;
  panel: Panel;
  onClose: () => void;
}) {
  const renaming = asking?.kind === "rename" ? asking.project : null;
  const removing = asking?.kind === "remove" ? asking.project : null;

  return (
    <>
      {/* ⚠️ ОКНО НА СТРАНИЦЕ, ТОЛЬКО ПОКА СПРАШИВАЕТ (task-103). Спрятанное
          окно помнило поля: второй «+» открывал прежний проект, будто его
          редактируют (владелец 17.09). Ключ по случаю лечил только смену
          проекта, а не повтор того же вопроса. */}
      {asking?.kind === "create" ? (
        <ProjectDialog
          title="Новый проект"
          submitLabel="Создать проект"
          onSubmit={(edit) => panel.addProject(edit.title, { icon: edit.icon, color: edit.color })}
          onClose={onClose}
        />
      ) : null}
      {renaming ? (
        <ProjectDialog
          title="Редактировать проект"
          before={renaming.title}
          lookBefore={renaming}
          submitLabel="Сохранить"
          onSubmit={(edit) => panel.renameProject(renaming.id, edit)}
          onClose={onClose}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Убрать проект «${removing.title}»?`}
          description="Исчезнет только папка — чаты останутся и переедут в «Недавние». Переписка не пропадёт."
          confirmLabel="Убрать"
          onCancel={onClose}
          onConfirm={() => {
            onClose();
            void panel.removeProject(removing.id);
          }}
        />
      ) : null}
    </>
  );
}
