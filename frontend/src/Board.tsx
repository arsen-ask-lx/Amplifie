import { useState } from "react";
import { api, type Participant, type Task } from "./api.js";
import { Icon } from "./Icon.js";

/**
 * Доска задач: колонки по стадиям (task-010).
 *
 * ПОЧЕМУ БЕЗ ПЕРЕТАСКИВАНИЯ. Доска без перетаскивания работает,
 * перетаскивание без доски — нет. Сперва колонки и кнопки, потом жесты.
 *
 * ⚠️ «ЗА РЕЗУЛЬТАТ ОТВЕЧАЕТ ЧЕЛОВЕК» — правило владельца, и держит его
 * база (составной ключ на `participant (id, kind)`). Здесь оно только
 * ПОКАЗАНО: в выбор ответственного попадают одни люди. Если экран
 * ошибётся, сервер и база всё равно откажут.
 */

/** Колонки в порядке движения слева направо. */
const COLUMNS = ["к работе", "в работе", "на проверке", "готово"] as const;

/** Пятая стадия. С доски прячется, но задача не удаляется. */
const HIDDEN = "отменена";

const when = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

/** Куда можно подвинуть отсюда: соседняя колонка слева и справа. */
function neighbours(stage: string): { back: string | null; next: string | null } {
  const at = COLUMNS.indexOf(stage as (typeof COLUMNS)[number]);
  if (at < 0) return { back: null, next: null };
  return { back: COLUMNS[at - 1] ?? null, next: COLUMNS[at + 1] ?? null };
}

function Card({
  task,
  people,
  onChange,
}: {
  task: Task;
  people: Participant[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { back, next } = neighbours(task.stage);

  async function apply(patch: Parameters<typeof api.patchTask>[1]) {
    setBusy(true);
    try {
      await api.patchTask(task.id, patch);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <p className="card-title">{task.title}</p>

      <p className="card-who">
        {/* Ответственный первым: за результат отвечает он, а не исполнитель. */}
        Отвечает: <b>{task.responsible?.name ?? "никто"}</b>
      </p>

      <label className="card-pick">
        Делает
        <select
          value={task.assignedTo?.id ?? ""}
          disabled={busy}
          onChange={(event) => void apply({ assignedToId: event.target.value || null })}
        >
          <option value="">никто</option>
          {people.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
              {one.kind === "agent" ? " (агент)" : ""}
            </option>
          ))}
        </select>
      </label>

      <p className="card-from">
        {task.fromAgreement ? "из договорённости" : "заведена руками"} ·{" "}
        <time dateTime={task.createdAt}>{when.format(new Date(task.createdAt))}</time>
      </p>

      <div className="card-move">
        <button
          type="button"
          className="quiet"
          disabled={busy || !back}
          onClick={() => back && void apply({ stage: back })}
        >
          ←
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy || !next}
          onClick={() => next && void apply({ stage: next })}
        >
          →
        </button>
      </div>
    </article>
  );
}

function NewTask({
  people,
  meId,
  onMade,
}: {
  people: Participant[];
  meId: string;
  onMade: () => void;
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
      onMade();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="board-new" onSubmit={(event) => void add(event)}>
      <input
        value={title}
        placeholder="Новая задача"
        onChange={(event) => setTitle(event.target.value)}
      />
      <select value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)}>
        {humans.map((one) => (
          <option key={one.id} value={one.id}>
            отвечает {one.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy || title.trim().length === 0}>
        <Icon name="плюс" />
        Завести
      </button>
    </form>
  );
}

export function Board({
  tasks,
  people,
  meId,
  onChange,
}: {
  tasks: Task[];
  people: Participant[];
  meId: string;
  onChange: () => void;
}) {
  const shown = tasks.filter((one) => one.stage !== HIDDEN);

  return (
    <>
      <NewTask people={people} meId={meId} onMade={onChange} />

      <div className="board">
        {COLUMNS.map((stage) => {
          const here = shown.filter((one) => one.stage === stage);
          return (
            <section key={stage} className="column" aria-label={stage}>
              <h4 className="column-head">
                {stage}{" "}
                {here.length > 0 ? <span className="column-count">{here.length}</span> : null}
              </h4>
              {here.map((task) => (
                <Card key={task.id} task={task} people={people} onChange={onChange} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
