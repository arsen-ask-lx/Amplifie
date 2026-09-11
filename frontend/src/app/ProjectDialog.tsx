import type { ProjectColor, ProjectIcon } from "@amplifie/contract";
import { useState } from "react";
import type { Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { fieldsOf, statusOf } from "../shared/failure.js";
import { PROJECT_ICONS, ЗначокПроекта, значокПоИмени, цветМетки } from "../shared/projectLook.js";
import { ЗНАЧКИ_ВСЛУХ, ЦВЕТА } from "../shared/projectLookNames.js";
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
function объяснить(ошибка: unknown): string {
  const поля = fieldsOf(ошибка);
  if (поля.title) return "Название не подошло: слишком длинное или пустое.";
  if (поля.icon || поля.color) {
    return "Такого значка или цвета сервер не знает — обновите страницу и выберите заново.";
  }
  return statusOf(ошибка) === null
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
  open,
  title,
  было,
  видБыл,
  создаём,
  кнопка,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** Заголовок окна: «Новый проект» либо «Переименовать проект». */
  title: string;
  /** Прежнее название. Пусто — заводим новый. */
  было?: string;
  /** Прежний вид папки. Пусто — вид по умолчанию. */
  видБыл?: { icon?: string | null; color?: string | null } | undefined;
  создаём: boolean;
  кнопка: string;
  onSubmit: (правка: { title: string; icon: string | null; color: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [имя, setИмя] = useState(было ?? "");
  const [значок, setЗначок] = useState<ProjectIcon | null>(
    (видБыл?.icon as ProjectIcon | undefined) ?? null,
  );
  const [цвет, setЦвет] = useState<ProjectColor | null>(
    (видБыл?.color as ProjectColor | undefined) ?? null,
  );
  const [видОткрыт, setВидОткрыт] = useState(!создаём);

  return (
    <FormDialog
      open={open}
      title={title}
      submitLabel={кнопка}
      canSubmit={имя.trim() !== ""}
      onSubmit={() => onSubmit({ title: имя.trim(), icon: значок, color: цвет })}
      explain={объяснить}
      onClose={onClose}
    >
      {(busy) => (
        <>
          <div className="flex items-center gap-2">
            {/* Образец строки показывает результат до сохранения, но не
                заставляет выбирать оформление ради создания проекта. */}
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-edge">
              <ЗначокПроекта icon={значок} color={цвет} className="size-5" />
            </span>
            <Input
              autoFocus
              value={имя}
              disabled={busy}
              maxLength={120}
              placeholder="например, Объект на Ленина"
              aria-label="Название проекта"
              onChange={(event) => setИмя(event.target.value)}
            />
          </div>

          {создаём ? (
            <p className="text-aside text-muted">
              Сначала назовите проект. Вид можно настроить сейчас или позже.
            </p>
          ) : null}

          {создаём && !видОткрыт ? (
            <button
              type="button"
              disabled={busy}
              aria-expanded={видОткрыт}
              onClick={() => setВидОткрыт(true)}
              className="w-fit rounded bg-raised px-2.5 py-1.5 text-aside text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Настроить вид
            </button>
          ) : null}

          {видОткрыт ? (
            <Выбор значок={значок} цвет={цвет} setЗначок={setЗначок} setЦвет={setЦвет} />
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

/**
 * Выбор цвета и значка папки (task-038).
 *
 * ⚠️ ИЗ НАШИХ НАБОРОВ, А НЕ ПРОИЗВОЛЬНЫЙ ЦВЕТ. Семь цветов проверены
 * гейтом контраста на всех девятнадцати темах; произвольный `#hex`
 * из окна выбора прошёл бы мимо любой проверки и стал бы невидимым
 * на половине тем. Значков девять десятков — список в общем пакете.
 *
 * ⚠️ У КАЖДОЙ КНОПКИ ЕСТЬ ИМЯ СЛОВАМИ. Кружок без имени недоступен
 * тому, кто цвета не различает: для него это семь одинаковых точек.
 */
function Выбор({
  значок,
  цвет,
  setЗначок,
  setЦвет,
}: {
  значок: ProjectIcon | null;
  цвет: ProjectColor | null;
  setЗначок: (one: ProjectIcon | null) => void;
  setЦвет: (one: ProjectColor | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ЦВЕТА) as ProjectColor[]).map((one) => (
          <button
            key={one}
            type="button"
            aria-label={ЦВЕТА[one]}
            aria-pressed={цвет === one}
            title={ЦВЕТА[one]}
            // Нажатие по выбранному снимает цвет: второй кнопки «без
            // цвета» не нужно, а вернуться к обычному виду человек хочет.
            onClick={() => setЦвет(цвет === one ? null : one)}
            className={[
              "size-6 rounded-pill border transition-colors",
              цвет === one ? "border-ink" : "border-transparent",
            ].join(" ")}
            style={{ backgroundColor: цветМетки(one) }}
          />
        ))}
      </div>

      {/* ⚠️ ВЫСОТА ОГРАНИЧЕНА, А НЕ «СКОЛЬКО ВЫЙДЕТ». Девяносто значков
          в шесть колонок дали пятнадцать рядов: окно перестало помещаться
          в экран, и кнопка «Завести» уехала за нижний край — завести
          проект стало нечем вовсе. Поймано живым прогоном, не глазами.

          Восемь колонок вместо шести и своя прокрутка: окно остаётся
          размером с окно, а список растёт внутрь. */}
      <div className="hide-scroll grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
        {PROJECT_ICONS.map((one) => {
          const Икс = значокПоИмени(one);
          return (
            <button
              key={one}
              type="button"
              aria-label={ЗНАЧКИ_ВСЛУХ[one]}
              aria-pressed={значок === one}
              title={ЗНАЧКИ_ВСЛУХ[one]}
              onClick={() => setЗначок(значок === one ? null : one)}
              className={[
                "grid size-8 place-items-center rounded-lg border transition-colors",
                значок === one
                  ? "border-accent bg-raised text-ink"
                  : "border-transparent text-muted",
                "hover:bg-raised hover:text-ink",
              ].join(" ")}
            >
              <Икс className="size-5" />
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
  спрашиваем,
  panel,
  onClose,
}: {
  спрашиваем:
    | { вид: "новый" }
    | { вид: "имя"; project: Project }
    | { вид: "убрать"; project: Project }
    | null;
  panel: Panel;
  onClose: () => void;
}) {
  const правим = спрашиваем?.вид === "имя" ? спрашиваем.project : null;
  const убираем = спрашиваем?.вид === "убрать" ? спрашиваем.project : null;

  return (
    <>
      <ProjectDialog
        open={спрашиваем?.вид === "новый" || правим !== null}
        title={правим ? "Редактировать проект" : "Новый проект"}
        было={правим?.title ?? ""}
        видБыл={правим ?? undefined}
        создаём={!правим}
        кнопка={правим ? "Сохранить" : "Создать проект"}
        // ⚠️ КЛЮЧ ПО СЛУЧАЮ: без него поле помнит прежнее имя, когда окно
        // открывают второй раз с другим проектом.
        key={правим?.id ?? "новый"}
        onSubmit={async (правка) => {
          if (правим) await panel.renameProject(правим.id, правка);
          else await panel.addProject(правка.title, { icon: правка.icon, color: правка.color });
        }}
        onClose={onClose}
      />

      {убираем ? (
        <ConfirmDialog
          title={`Убрать проект «${убираем.title}»?`}
          description="Исчезнет только папка — чаты останутся и переедут в «Недавние». Переписка не пропадёт."
          confirmLabel="Убрать"
          onCancel={onClose}
          onConfirm={() => {
            onClose();
            void panel.removeProject(убираем.id);
          }}
        />
      ) : null}
    </>
  );
}
