import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { task } from "./schema.js";

/** Слой хранилища модуля work. Только запросы, никакой логики. */

/**
 * Сменить статус. Пространство проверяется здесь же: чужую договорённость
 * не тронуть, и снаружи это неотличимо от «её нет».
 */

/**
 * Договорённости пространства вместе с тем, что нужно человеку для решения:
 * в каком разговоре сказано и кто это предложил.
 *
 * Соединение здесь, а не вторым запросом из службы: два запроса — два
 * снимка базы, и на этом мы уже обжигались в догоне.
 */

/**
 * Цитаты с номером сообщения и именем того, кто его написал.
 *
 * Номер, а не только идентификатор: лента листается номерами, и без него
 * «перейти к реплике» неисполнимо. Имя — это «кто попросил» из бизнес-ТЗ,
 * и это автор РЕПЛИКИ, а не автор предложения: их легко перепутать,
 * потому что предложение пишет агент, а обещание давал человек.
 */

/** Задача из договорённости. Повторное подтверждение второй не заводит. */
export async function insertTask(
  tx: Executor,
  input: {
    workspaceId: string;
    title: string;
    /** Только человек. Держит база: составной ключ на (id, kind). */
    responsibleId?: string | null;
  },
) {
  const rows = await tx.insert(task).values(input).onConflictDoNothing().returning();
  return rows[0] ?? null;
}

/** Перевести задачу и/или переназначить. Чужую не находит — значит и не трогает. */
export async function patchTask(
  tx: Executor,
  workspaceId: string,
  id: string,
  patch: {
    status?: string;
    assignedTo?: string | null;
    responsibleId?: string;
    discussionId?: string;
    failedRuns?: number;
  },
) {
  const rows = await tx
    .update(task)
    .set(patch)
    .where(and(eq(task.id, id), eq(task.workspaceId, workspaceId)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Задачи вместе с разговором, из которого они родились (К5), исполнителем
 * и ответственным.
 *
 * ⚠️ СОЕДИНЕНИЯ ЛЕВЫЕ, а не внутренние. С task-010 задача бывает своя,
 * без договорённости, и внутреннее соединение просто СПРЯТАЛО БЫ её
 * с доски — молча, без единой ошибки. Это тот случай, когда неверный
 * вид соединения не падает, а обманывает.
 */
export async function listTasksIn(tx: Executor, workspaceId: string) {
  const doer = alias(participant, "doer");
  const owner = alias(participant, "owner");

  return tx
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      discussionId: task.discussionId,
      failedRuns: task.failedRuns,
      assignedToId: doer.id,
      assignedToName: doer.displayName,
      assignedToKind: doer.kind,
      responsibleId: owner.id,
      responsibleName: owner.displayName,
    })
    .from(task)
    .leftJoin(doer, eq(doer.id, task.assignedTo))
    .leftJoin(owner, eq(owner.id, task.responsibleId))
    .where(eq(task.workspaceId, workspaceId))
    .orderBy(desc(task.createdAt));
}

/** Участник этого пространства — для проверки «ответственный человек». */
export async function findParticipant(tx: Executor, workspaceId: string, id: string) {
  const rows = await tx
    .select({ id: participant.id, kind: participant.kind })
    .from(participant)
    .where(and(eq(participant.id, id), eq(participant.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Участники пространства: кого можно назначить исполнителем. */
export async function listParticipantsIn(tx: Executor, workspaceId: string) {
  return tx
    .select({ id: participant.id, name: participant.displayName, kind: participant.kind })
    .from(participant)
    .where(eq(participant.workspaceId, workspaceId))
    .orderBy(participant.displayName);
}

/** Одна задача по идентификатору. Нужна прогону: счётчик отказов и обсуждение. */
export async function findTask(tx: Executor, workspaceId: string, id: string) {
  const rows = await tx
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
