import { HIDDEN_STAGE } from "@amplifie/contract";
import { Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { api, type Participant, type Task } from "../data/api.js";

import { Button } from "../shared/ui/button.js";
import { Input } from "../shared/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../shared/ui/select.js";

import { Card, COLUMNS } from "./board/Card.js";

/**
 * Доска задач: колонки по стадиям (task-010), вид переработан в task-013.
 *
 * ЧТО БЫЛО НЕ ТАК. Карточка показывала название, «Отвечает», «Делает» и дату
 * ОДНИМ весом, а самым заметным в ней был системный серый `<select>`. Кнопки
 * «влево-вправо» занимали половину карточки, хотя двигают задачу раз в день.
 * Глаз не находил главное, потому что главного не было назначено.
 *
 * ЧТО СТАЛО. Иерархия в три ступени:
 *   1. НАЗВАНИЕ — крупно и основным цветом. Ради него карточку и открывают;
 *   2. кто отвечает — приглушённо, но именем: это единственное поле,
 *      которое отвечает на вопрос «с кого спросить»;
 *   3. всё остальное — мелко и тихо: происхождение, дата, смена исполнителя.
 *
 * Управление показывается ПРИ НАВЕДЕНИИ и остаётся доступным с клавиатуры
 * (`focus-within`). Кнопка, которую видно всегда, соревнуется за внимание
 * с содержимым — а карточка существует ради содержимого.
 *
 * ⚠️ «ЗА РЕЗУЛЬТАТ ОТВЕЧАЕТ ЧЕЛОВЕК» — правило владельца, и держит его
 * база (составной ключ на `participant (id, kind)`). Здесь оно только
 * ПОКАЗАНО: в выбор ответственного попадают одни люди. Если экран
 * ошибётся, сервер и база всё равно откажут.
 */

function NewTask({
  people,
  meId,
  onMade,
}: {
  people: Participant[];
  meId: string;
  onMade: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  // Ответственный по умолчанию — я. Завёл задачу, значит взял на себя,
  // пока не сказал иначе.
  const humans = people.filter((one) => one.kind === "human");
  const [responsibleId, setResponsibleId] = useState(meId);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.addTask({ title: title.trim(), responsibleId });
      setTitle("");
      await onMade();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mb-5 flex flex-wrap items-center gap-2" onSubmit={(e) => void add(e)}>
      <Input
        value={title}
        placeholder="Новая задача"
        aria-label="Название новой задачи"
        onChange={(event) => setTitle(event.target.value)}
        className="min-w-60 flex-1"
      />
      <Select value={responsibleId} onValueChange={setResponsibleId}>
        <SelectTrigger className="w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {humans.map((one) => (
            <SelectItem key={one.id} value={one.id}>
              отвечает {one.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={busy || title.trim().length === 0}>
        <Plus />
        Завести
      </Button>
    </form>
  );
}

export function Board({
  tasks,
  people,
  meId,
  namedId,
  onPatched,
  onListChanged,
}: {
  tasks: Task[];
  people: Participant[];
  meId: string;
  /** Задача из адреса `/board/:taskId`, если он её назвал. */
  namedId: string | null;
  /** Одна задача изменилась, и сервер вернул её целиком. */
  onPatched: (task: Task) => void;
  /** Список изменился: завели новую либо прогон переставил стадию. */
  onListChanged: () => void | Promise<void>;
}) {
  const shown = tasks.filter((one) => one.stage !== HIDDEN_STAGE);

  return (
    <>
      <NewTask people={people} meId={meId} onMade={onListChanged} />

      {/* Колонки одной ширины и не сжимаются ниже читаемого: доска
          прокручивается вбок, а не превращается в столбик карточек.
          До task-013 на узком окне канбан складывался в один список,
          и стадии переставали быть видны — то есть исчезал он весь. */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((stage) => {
          const here = shown.filter((one) => one.stage === stage);
          return (
            <section
              key={stage}
              aria-label={stage}
              className="flex w-72 shrink-0 flex-col gap-3 rounded-xl bg-panel p-3"
            >
              <h4 className="flex items-center gap-2 px-1 text-aside text-muted">
                {stage}
                <span className="text-mark text-muted">{here.length > 0 ? here.length : ""}</span>
              </h4>

              {here.map((task) => (
                <Card
                  key={task.id}
                  task={task}
                  people={people}
                  named={task.id === namedId}
                  onPatched={onPatched}
                  onRan={onListChanged}
                />
              ))}

              {/* Пустая колонка говорит, что она пустая. Пустой прямоугольник
                  читается как «не загрузилось», а не как «здесь ничего нет». */}
              {here.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-aside text-muted">
                  пусто
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
