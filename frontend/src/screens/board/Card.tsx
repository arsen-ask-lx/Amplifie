import { BREAKER, HIDDEN_STAGE, STAGES, type Stage } from "@amplifie/contract";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, type Participant, type Task } from "../../data/api.js";
import { troubleOf } from "../../shared/trouble.js";
import { Button } from "../../shared/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../shared/ui/tooltip.js";
import { день } from "../../shared/when.js";

/**
 * Карточка задачи и всё, что делается прямо на ней.
 *
 * ВЫНЕСЕНА ИЗ ДОСКИ, потому что у той стало два разных дела: разложить
 * задачи по колонкам и показать одну задачу. Гейт размера файла был прав
 * — 380 строк на «доску» означали, что в один файл дописывают всё, что
 * рядом по смыслу.
 *
 * ЧТО ЗДЕСЬ ВАЖНО ПО ВИДУ (task-013). Иерархия в три ступени: название
 * читается издалека, ответственный — приглушённо, остальное тихо и
 * появляется при наведении. Кнопка, которую видно всегда, соревнуется
 * за внимание с содержимым, а карточка существует ради содержимого.
 *
 * ⚠️ «ЗА РЕЗУЛЬТАТ ОТВЕЧАЕТ ЧЕЛОВЕК» держит база (составной ключ на
 * `participant (id, kind)`). Здесь оно только ПОКАЗАНО.
 */

/** Колонки в порядке движения. Скрытая стадия на доску не попадает. */
export const COLUMNS = STAGES.filter((stage) => stage !== HIDDEN_STAGE);

/** Куда можно подвинуть отсюда: соседняя колонка слева и справа. */
function neighbours(stage: string): { back: string | null; next: string | null } {
  const at = COLUMNS.indexOf(stage as Stage);
  if (at < 0) return { back: null, next: null };
  return { back: COLUMNS[at - 1] ?? null, next: COLUMNS[at + 1] ?? null };
}

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
    <div className="mt-3">
      <Button
        size="sm"
        variant={broken ? "secondary" : "default"}
        disabled={busy || broken}
        onClick={() => void start()}
      >
        {busy ? "Делает…" : "Пусть сделает"}
      </Button>
      {broken ? (
        <p className="mt-2 text-aside text-danger">
          Два отказа подряд. Третьей попытки не будет — посмотрите сами и верните задачу в работу.
        </p>
      ) : null}
      {failure ? <p className="mt-2 text-aside text-danger">{failure}</p> : null}
    </div>
  );
}

/** Стрелка «подвинуть». Тихая и с подписью — стрелка сама по себе немая. */
function Move({
  where,
  stage,
  disabled,
  onMove,
}: {
  where: "назад" | "вперёд";
  stage: string | null;
  disabled: boolean;
  onMove: (stage: string) => void;
}) {
  const Arrow = where === "назад" ? ArrowLeft : ArrowRight;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={stage ? `Подвинуть: ${stage}` : `Двигать ${where} некуда`}
          disabled={disabled || !stage}
          onClick={() => stage && onMove(stage)}
        >
          <Arrow />
        </Button>
      </TooltipTrigger>
      {stage ? <TooltipContent>{stage}</TooltipContent> : null}
    </Tooltip>
  );
}

export function Card({
  task,
  people,
  named,
  onPatched,
  onRan,
}: {
  task: Task;
  people: Participant[];
  /** На эту задачу указывает адрес: `/board/:taskId` (Р-019). */
  named: boolean;
  onPatched: (task: Task) => void;
  onRan: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLElement>(null);
  const { back, next } = neighbours(task.stage);
  const byAgent = task.assignedTo?.kind === "agent";

  // Пришли по ссылке на задачу — доводим до неё и помечаем каймой акцента.
  useEffect(() => {
    if (named) box.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [named]);

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
    <article
      ref={box}
      aria-current={named ? "true" : undefined}
      className={[
        "group rounded-xl border bg-card p-4 shadow-raised transition-colors",
        named ? "border-accent" : "border-line hover:border-edge",
      ].join(" ")}
    >
      {/* Название — единственное, что читается издалека. */}
      <p className="text-lead leading-snug font-medium text-ink">{task.title}</p>

      {/* Ответственный сразу под названием: за результат отвечает он,
          а не исполнитель, и это второй по важности вопрос к карточке. */}
      <p className="mt-2 text-aside text-muted">
        отвечает <span className="text-ink">{task.responsible?.name ?? "никто"}</span>
      </p>

      {byAgent ? <Run task={task} onDone={onRan} /> : null}

      {/* Тихий ряд: происхождение, дата, смена исполнителя и стрелки.
          Появляется при наведении и при фокусе с клавиатуры — иначе
          управление соревнуется за внимание с содержимым карточки. */}
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <Select
          value={task.assignedTo?.id ?? "никто"}
          disabled={busy}
          onValueChange={(value: string) =>
            void apply({ assignedToId: value === "никто" ? null : value })
          }
        >
          <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 border-0 px-2 text-aside">
            <SelectValue placeholder="делает никто" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="никто">делает никто</SelectItem>
            {people.map((one) => (
              <SelectItem key={one.id} value={one.id}>
                делает {one.name}
                {one.kind === "agent" ? " (агент)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Move
            where="назад"
            stage={back}
            disabled={busy}
            onMove={(stage) => void apply({ stage })}
          />
          <Move
            where="вперёд"
            stage={next}
            disabled={busy}
            onMove={(stage) => void apply({ stage })}
          />
        </div>
      </div>

      <p className="mt-2 text-mark text-muted">
        <time dateTime={task.createdAt}>{день.format(new Date(task.createdAt))}</time>
      </p>
    </article>
  );
}
