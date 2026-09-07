import { BREAKER, HIDDEN_STAGE, STAGES, type Stage } from "@amplifie/contract";
import { useState } from "react";
import { api, type Participant, type Task } from "./api.js";
import { Icon } from "./Icon.js";
import { troubleOf } from "./shared/trouble.js";
import { день } from "./shared/when.js";

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

/**
 * Колонки в порядке движения слева направо.
 *
 * Порядок и состав приходят из `@amplifie/contract` — до task-012 список
 * был переписан здесь вручную, третьей копией после базы и сервера.
 * Скрытая стадия отфильтрована, а не вырезана из объявления: доска
 * решает, что показывать, но не решает, какие стадии бывают.
 */
const COLUMNS = STAGES.filter((stage) => stage !== HIDDEN_STAGE);

/** Почему прогон не удался — словами доски. Причину считает общий слой. */
const SAYS: Record<string, string> = {
  размыкатель: "Два отказа подряд — дальше нужен человек.",
  "нет-модели": "Нейросеть не подключена: раздел «Агенты».",
  "мост-молчит": "Мост взял работу и не ответил вовремя.",
  "модель-отказала": "Нейросеть вернула ошибку. Попробуйте ещё раз.",
};

function whyNot(error: unknown): string {
  return SAYS[troubleOf(error)] ?? "Не получилось запустить.";
}

/** Куда можно подвинуть отсюда: соседняя колонка слева и справа. */
function neighbours(stage: string): { back: string | null; next: string | null } {
  const at = COLUMNS.indexOf(stage as Stage);
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
function Run({ task, onDone }: { task: Task; onDone: () => void | Promise<void> }) {
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
      // Прогон меняет стадию, счётчик отказов и заводит обсуждение —
      // ответ ручки этого не несёт, поэтому перечитываем задачи. Только их.
      await onDone();
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
  onPatched,
  onRan,
}: {
  task: Task;
  people: Participant[];
  onPatched: (task: Task) => void;
  onRan: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { back, next } = neighbours(task.stage);
  const byAgent = task.assignedTo?.kind === "agent";

  async function apply(patch: Parameters<typeof api.patchTask>[1]) {
    setBusy(true);
    try {
      // Сервер возвращает задачу целиком — берём ЕГО ответ, а не идём
      // за всем списком заново. До task-012 один ход карты стоил трёх
      // запросов, включая участников, которые при этом не меняются.
      onPatched(await api.patchTask(task.id, patch));
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
        <time dateTime={task.createdAt}>{день.format(new Date(task.createdAt))}</time>
      </p>

      {byAgent ? <Run task={task} onDone={onRan} /> : null}

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
  onPatched,
  onListChanged,
}: {
  tasks: Task[];
  people: Participant[];
  meId: string;
  /** Одна задача изменилась, и сервер вернул её целиком. */
  onPatched: (task: Task) => void;
  /** Список изменился: завели новую либо прогон переставил стадию. */
  onListChanged: () => void | Promise<void>;
}) {
  const shown = tasks.filter((one) => one.stage !== HIDDEN_STAGE);

  return (
    <>
      <NewTask people={people} meId={meId} onMade={onListChanged} />

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
                <Card
                  key={task.id}
                  task={task}
                  people={people}
                  onPatched={onPatched}
                  onRan={onListChanged}
                />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
