import type { ProjectColor, ProjectIcon } from "@amplifie/contract";
import { useState } from "react";
import type { Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { fieldsOf, statusOf } from "../shared/failure.js";
import { iconByName, labelColor, PROJECT_ICONS, ProjectGlyph } from "../shared/projectLook.js";
import { COLOR_LABELS, ICON_LABELS } from "../shared/projectLookNames.js";
import { ConfirmDialog, FormDialog } from "../shared/ui/ask-dialog.js";
import { Input } from "../shared/ui/input.js";

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
    return "Такого значка или цвета сервер не знает — обновите страницу и выберите заново.";
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
  creating,
  submitLabel,
  onSubmit,
  onClose,
}: {
  /** Заголовок окна: «Новый проект» либо «Переименовать проект». */
  title: string;
  /** Прежнее название. Пусто — заводим новый. */
  before?: string;
  /** Прежний вид папки. Пусто — вид по умолчанию. */
  lookBefore?: { icon?: string | null; color?: string | null } | undefined;
  creating: boolean;
  submitLabel: string;
  onSubmit: (edit: { title: string; icon: string | null; color: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(before ?? "");
  const [icon, setIcon] = useState<ProjectIcon | null>(
    (lookBefore?.icon as ProjectIcon | undefined) ?? null,
  );
  const [color, setColor] = useState<ProjectColor | null>(
    (lookBefore?.color as ProjectColor | undefined) ?? null,
  );
  const [lookOpen, setLookOpen] = useState(!creating);

  return (
    <FormDialog
      title={title}
      submitLabel={submitLabel}
      canSubmit={name.trim() !== ""}
      onSubmit={() => onSubmit({ title: name.trim(), icon: icon, color: color })}
      explain={explain}
      onClose={onClose}
    >
      {(busy) => (
        <>
          <div className="flex items-center gap-2">
            {/* Образец строки показывает результат до сохранения, но не
                заставляет выбирать оформление ради создания проекта. */}
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-edge">
              <ProjectGlyph icon={icon} color={color} className="size-5" />
            </span>
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

          {creating ? (
            <p className="text-aside text-muted">
              Сначала назовите проект. Вид можно настроить сейчас или позже.
            </p>
          ) : null}

          {creating && !lookOpen ? (
            <button
              type="button"
              disabled={busy}
              aria-expanded={lookOpen}
              onClick={() => setLookOpen(true)}
              className="w-fit rounded bg-raised px-2.5 py-1.5 text-aside text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Настроить вид
            </button>
          ) : null}

          {lookOpen ? (
            <Picker icon={icon} color={color} setIcon={setIcon} setColor={setColor} />
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

/**
 * Выбор цвета и значка папки (task-038, task-103).
 *
 * ⚠️ ИЗ НАШИХ НАБОРОВ, А НЕ ПРОИЗВОЛЬНЫЙ ЦВЕТ. Шестнадцать цветов проверены
 * гейтом контраста под белым значком; произвольный `#hex` из пипетки
 * прошёл бы мимо любой проверки (владелец 17.09 выбрал набор, а не пипетку).
 * Значков девять десятков — список в общем пакете.
 *
 * ⚠️ У КАЖДОЙ КНОПКИ ЕСТЬ ИМЯ СЛОВАМИ. Кружок без имени недоступен
 * тому, кто цвета не различает: для него это одинаковые точки.
 */
function Picker({
  icon,
  color,
  setIcon,
  setColor,
}: {
  icon: ProjectIcon | null;
  color: ProjectColor | null;
  setIcon: (one: ProjectIcon | null) => void;
  setColor: (one: ProjectColor | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Шестнадцать кружков — сеткой 8×2 и группой с именем: рядом девяносто
          кнопок-значков, и читалке нужна граница «здесь цвета». */}
      <fieldset className="grid w-fit grid-cols-8 gap-2">
        <legend className="sr-only">Цвет</legend>
        {(Object.keys(COLOR_LABELS) as ProjectColor[]).map((one) => (
          <button
            key={one}
            type="button"
            aria-label={COLOR_LABELS[one]}
            aria-pressed={color === one}
            title={COLOR_LABELS[one]}
            // Нажатие по выбранному снимает цвет: второй кнопки «без
            // цвета» не нужно, а вернуться к обычному виду человек хочет.
            onClick={() => setColor(color === one ? null : one)}
            className={[
              "size-6 rounded-pill border transition-colors",
              color === one ? "border-ink" : "border-transparent",
            ].join(" ")}
            style={{ backgroundColor: labelColor(one) }}
          />
        ))}
      </fieldset>

      {/* ⚠️ ВЫСОТА ОГРАНИЧЕНА, А НЕ «СКОЛЬКО ВЫЙДЕТ». Девяносто значков
          в шесть колонок дали пятнадцать рядов: окно перестало помещаться
          в экран, и кнопка «Завести» уехала за нижний край — завести
          проект стало нечем вовсе. Поймано живым прогоном, не глазами.

          Восемь колонок вместо шести и своя прокрутка: окно остаётся
          размером с окно, а список растёт внутрь. */}
      <div className="hide-scroll grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
        {PROJECT_ICONS.map((one) => {
          const Glyph = iconByName(one);
          return (
            <button
              key={one}
              type="button"
              aria-label={ICON_LABELS[one]}
              aria-pressed={icon === one}
              title={ICON_LABELS[one]}
              onClick={() => setIcon(icon === one ? null : one)}
              className={[
                "grid size-8 place-items-center rounded-lg border transition-colors",
                icon === one ? "border-accent bg-raised text-ink" : "border-transparent text-muted",
                "hover:bg-raised hover:text-ink",
              ].join(" ")}
            >
              <Glyph className="size-5" />
            </button>
          );
        })}
      </div>
    </div>
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
          creating
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
          creating={false}
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
