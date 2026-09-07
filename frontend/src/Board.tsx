import { useState } from "react";
import { ApiError, api, type Participant, type Task } from "./api.js";
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

/** Столько отказов подряд размыкают. Совпадает с сервером (task-011). */
const BREAKER = 2;

const when = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

/** Почему прогон не удался — человеческими словами. */
function whyNot(error: unknown): string {
  const code = error instanceof ApiError ? error.status : 0;
  if (code === 409) return "Два отказа подряд — дальше нужен человек.";
  if (code === 503) return "Нейросеть не подключена: раздел «Агенты».";
  if (code === 504) return "Мост взял работу и не ответил вовремя.";
  if (code === 502) return "Нейросеть вернула ошибку. Попробуйте ещё раз.";
  return "Не получилось запустить.";
}

/** Куда можно подвинуть отсюда: соседняя колонка слева и справа. */
function neighbours(stage: string): { back: string | null; next: string | null } {
  const at = COLUMNS.indexOf(stage as (typeof COLUMNS)[number]);
  if (at < 0) return { back: null, next: null };
  return { back: COLUMNS[at - 1] ?? null, next: COLUMNS[at + 1] ?? null };
}

/**
 * Прогон агента по задаче.
 *
 * Отдельным компонентом, а не строкой в карточке: у карточки стало три
 * разных дела — показать, подвинуть и запустить, — и линтер сложности
 * был прав. Заодно состояние прогона не мешается с состоянием правки.
 */
function Run({ task, onDone }: { task: Task; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Размыкатель: два отказа подряд — дальше нужен человек, а не третья
  // попытка (task-011). Кнопка гаснет, и рядом сказано почему.
  const broken = task.failedRuns >= BREAKER;

  async function start() {
    setBusy(true);
    setFailure(null);
    try {
      await api.runTask(task.id);
      onDone();
    } catch (error) {
      setFailure(whyNot(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-card-run">
      <button type="button" disabled={busy || broken} onClick={() => void start()}>
        {busy ? "Делает…" : "Пусть сделает"}
      </button>
      {broken ? (
        <p className="task-card-broken">
          Два отказа подряд. Третьей попытки не будет — посмотрите сами и верните задачу в работу.
        </p>
      ) : null}
      {failure ? <p className="task-card-broken">{failure}</p> : null}
    </div>
  );
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
  const byAgent = task.assignedTo?.kind === "agent";

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
    <article className="task-card">
      <p className="task-card-title">{task.title}</p>

      <p className="task-card-who">
        {/* Ответственный первым: за результат отвечает он, а не исполнитель. */}
        Отвечает: <b>{task.responsible?.name ?? "никто"}</b>
      </p>

      <label className="task-card-pick">
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

      <p className="task-card-from">
        {task.fromAgreement ? "из договорённости" : "заведена руками"} ·{" "}
        <time dateTime={task.createdAt}>{when.format(new Date(task.createdAt))}</time>
      </p>

      {byAgent ? <Run task={task} onDone={onChange} /> : null}

      <div className="task-card-move">
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
