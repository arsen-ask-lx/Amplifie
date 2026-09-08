import type { Stage } from "@amplifie/contract";
import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";

/**
 * Ядро работы: задачи и доска.
 *
 * ⚠️ ДОГОВОРЁННОСТИ УБРАНЫ ЦЕЛИКОМ (владелец, 2026-09-07). Здесь была
 * связка «агент предложил → человек подтвердил → родилась задача»,
 * а вместе с ней таблицы `agreement` и `citation`. Задача теперь
 * заводится напрямую: руками с доски либо агентом по явной просьбе.
 *
 * Здесь нет ни модели, ни правил распознавания: их место в `agent/`,
 * который выбрасывается целиком.
 */

export interface Actor {
  workspaceId: string;
  participantId: string;
  kind: string;
}

export { STAGES, type Stage } from "@amplifie/contract";

export class TaskNotVisibleError extends Error {}
export class NotHumanError extends Error {}

export interface TaskView {
  id: string;
  title: string;
  stage: string;
  createdAt: Date;
  assignedTo: { id: string; name: string; kind: string } | null;
  responsible: { id: string; name: string } | null;
  /** Обсуждение задачи. Пусто, пока не было ни одного прогона. */
  discussionId: string | null;
  /** Отказов подряд. Два — размыкатель разомкнут (task-011). */
  failedRuns: number;
}

function presentTask(row: Awaited<ReturnType<typeof repo.listTasksIn>>[number]): TaskView {
  return {
    id: row.id,
    title: row.title,
    stage: row.status,
    createdAt: row.createdAt,
    assignedTo: row.assignedToId
      ? { id: row.assignedToId, name: row.assignedToName ?? "", kind: row.assignedToKind ?? "" }
      : null,
    responsible: row.responsibleId
      ? { id: row.responsibleId, name: row.responsibleName ?? "" }
      : null,
    discussionId: row.discussionId,
    failedRuns: row.failedRuns,
  };
}

/** Задачи пространства, свежие сверху. */
export async function listTasks(workspaceId: string): Promise<TaskView[]> {
  const rows = await repo.listTasksIn(db, workspaceId);
  return rows.map(presentTask);
}

/**
 * Завести задачу.
 *
 * Ответственный обязателен и обязан быть человеком. Проверяем здесь, чтобы
 * человек получил внятный отказ, а не пятисотку от базы; но НАСТОЯЩИЙ рубеж
 * стоит в базе (составной ключ на `participant (id, kind)`), и обойти его
 * не может ни этот код, ни следующий, ни запрос из консоли.
 */
export async function createTask(
  actor: Actor,
  input: { title: string; responsibleId: string; assignedToId?: string | null | undefined },
): Promise<TaskView> {
  await requireHuman(actor.workspaceId, input.responsibleId);

  const created = await withTransaction(async (tx) => {
    const row = await repo.insertTask(tx, {
      workspaceId: actor.workspaceId,
      title: input.title,
      responsibleId: input.responsibleId,
    });
    if (!row) throw new TaskNotVisibleError();

    if (input.assignedToId) {
      await repo.patchTask(tx, actor.workspaceId, row.id, { assignedTo: input.assignedToId });
    }

    await appendEvent(tx, {
      kind: "task.created",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      subjectType: "task",
      subjectId: row.id,
      payload: { byHand: true },
    });
    return row;
  });

  return oneTask(actor.workspaceId, created.id);
}

/** Что из правки ложится в столбцы. Вынесено, чтобы правка читалась одной строкой. */
function columnsOf(patch: {
  stage?: Stage | undefined;
  assignedToId?: string | null | undefined;
  responsibleId?: string | undefined;
}) {
  return {
    ...(patch.stage ? { status: patch.stage } : {}),
    ...(patch.assignedToId !== undefined ? { assignedTo: patch.assignedToId } : {}),
    ...(patch.responsibleId ? { responsibleId: patch.responsibleId } : {}),
  };
}

/**
 * Записать, что изменилось.
 *
 * Перевод в ту же стадию события НЕ пишет: журнал не должен зарастать
 * записями о том, что ничего не изменилось.
 */
async function noteChanges(
  tx: Executor,
  actor: Actor,
  id: string,
  before: TaskView,
  patch: { stage?: Stage | undefined; assignedToId?: string | null | undefined },
): Promise<void> {
  const common = {
    workspaceId: actor.workspaceId,
    actorParticipantId: actor.participantId,
    subjectType: "task",
    subjectId: id,
  } as const;

  if (patch.stage && patch.stage !== before.stage) {
    await appendEvent(tx, {
      ...common,
      kind: "task.moved",
      payload: { from: before.stage, to: patch.stage },
    });
  }
  if (patch.assignedToId !== undefined) {
    await appendEvent(tx, {
      ...common,
      kind: "task.assigned",
      payload: { to: patch.assignedToId },
    });
  }
}

/**
 * Подвинуть по доске и/или переназначить.
 *
 * Исполнителем может быть кто угодно, включая агента, — в этом и смысл.
 * Ответственным — только человек.
 */
export async function patchTask(
  actor: Actor,
  id: string,
  patch: {
    stage?: Stage | undefined;
    assignedToId?: string | null | undefined;
    responsibleId?: string | undefined;
  },
): Promise<TaskView> {
  if (patch.responsibleId) await requireHuman(actor.workspaceId, patch.responsibleId);

  const before = (await listTasks(actor.workspaceId)).find((one) => one.id === id);
  if (!before) throw new TaskNotVisibleError();

  await withTransaction(async (tx) => {
    const changed = await repo.patchTask(tx, actor.workspaceId, id, columnsOf(patch));
    if (!changed) throw new TaskNotVisibleError();
    await noteChanges(tx, actor, id, before, patch);
  });

  return oneTask(actor.workspaceId, id);
}

async function oneTask(workspaceId: string, id: string): Promise<TaskView> {
  const found = (await listTasks(workspaceId)).find((one) => one.id === id);
  if (!found) throw new TaskNotVisibleError();
  return found;
}

/** Кого можно назначить исполнителем: все участники пространства. */
export async function listParticipants(
  workspaceId: string,
): Promise<Array<{ id: string; name: string; kind: string }>> {
  return repo.listParticipantsIn(db, workspaceId);
}

/** Участник существует, он свой и он человек. */
async function requireHuman(workspaceId: string, participantId: string): Promise<void> {
  const found = await repo.findParticipant(db, workspaceId, participantId);
  if (!found) throw new TaskNotVisibleError();
  if (found.kind !== "human") {
    throw new NotHumanError("ответственным за результат может быть только человек");
  }
}

/** Одна задача пространства. Чужая не находится — и это ответ «нет». */
export async function oneTaskFor(workspaceId: string, id: string): Promise<TaskView | null> {
  return (await listTasks(workspaceId)).find((one) => one.id === id) ?? null;
}

/** Привязать обсуждение. Отдельно от `patchTask`: это не правка человеком. */
export async function setDiscussion(
  workspaceId: string,
  id: string,
  discussionId: string,
): Promise<void> {
  await repo.patchTask(db, workspaceId, id, { discussionId });
}

/**
 * Записать исход прогона и подвинуть счётчик отказов.
 *
 * Успех СБРАСЫВАЕТ счётчик, а не уменьшает: размыкатель считает отказы
 * ПОДРЯД. Иначе он однажды сработал бы на задаче, которая давно работает,
 * — просто потому, что за месяц накопилось два случайных отказа.
 */
export async function markRun(
  actor: { workspaceId: string; participantId: string },
  id: string,
  outcome: "успех" | "отказ",
  detail: Record<string, unknown>,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await repo.findTask(tx, actor.workspaceId, id);
    if (!before) throw new TaskNotVisibleError();

    const failedRuns = outcome === "успех" ? 0 : before.failedRuns + 1;
    await repo.patchTask(tx, actor.workspaceId, id, { failedRuns });

    await appendEvent(tx, {
      kind: outcome === "успех" ? "task.run.успех" : "task.run.отказ",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      subjectType: "task",
      subjectId: id,
      // Числа и вид отказа. Ни задания, ни результата: журнал живёт
      // дольше задачи и читается шире.
      payload: { ...detail, failedRuns },
    });

    if (outcome === "отказ" && failedRuns >= 2) {
      await appendEvent(tx, {
        kind: "task.run.разомкнут",
        workspaceId: actor.workspaceId,
        actorParticipantId: actor.participantId,
        subjectType: "task",
        subjectId: id,
        payload: { failedRuns },
      });
    }
  });
}
