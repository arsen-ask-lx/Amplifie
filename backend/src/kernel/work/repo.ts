import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { conversation, message } from "../talk/schema.js";
import { agreement, citation, task } from "./schema.js";

/** Слой хранилища модуля work. Только запросы, никакой логики. */

export async function insertAgreement(
  tx: Executor,
  input: {
    workspaceId: string;
    conversationId: string;
    proposedBy: string;
    text: string;
    sourceFingerprint: string;
  },
) {
  // Тот же отпечаток — та же договорённость. Повторный разбор разговора
  // не должен плодить вторую: `onConflictDoNothing` отдаёт пустой список,
  // и вызывающий понимает, что нового не появилось.
  const rows = await tx.insert(agreement).values(input).onConflictDoNothing().returning();
  return rows[0] ?? null;
}

export async function insertCitation(
  tx: Executor,
  input: { workspaceId: string; agreementId: string; messageId: string; quote: string },
) {
  await tx.insert(citation).values(input);
}

/**
 * Сменить статус. Пространство проверяется здесь же: чужую договорённость
 * не тронуть, и снаружи это неотличимо от «её нет».
 */
export async function setAgreementStatus(
  tx: Executor,
  input: {
    id: string;
    workspaceId: string;
    status: string;
    confirmedBy: string | null;
    now: Date;
  },
) {
  const rows = await tx
    .update(agreement)
    .set({
      status: input.status,
      // Оба поля подтверждения ставятся ОДНИМ запросом: «подтверждено,
      // но неизвестно кем» не должно существовать даже на миг.
      confirmedBy: input.confirmedBy,
      confirmedAt: input.confirmedBy ? input.now : null,
    })
    .where(and(eq(agreement.id, input.id), eq(agreement.workspaceId, input.workspaceId)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Договорённости пространства вместе с тем, что нужно человеку для решения:
 * в каком разговоре сказано и кто это предложил.
 *
 * Соединение здесь, а не вторым запросом из службы: два запроса — два
 * снимка базы, и на этом мы уже обжигались в догоне.
 */
export async function listAgreementsIn(tx: Executor, workspaceId: string) {
  return tx
    .select({
      id: agreement.id,
      conversationId: agreement.conversationId,
      conversationTitle: conversation.title,
      text: agreement.text,
      status: agreement.status,
      proposedById: agreement.proposedBy,
      proposedByName: participant.displayName,
      confirmedBy: agreement.confirmedBy,
      createdAt: agreement.createdAt,
    })
    .from(agreement)
    .innerJoin(conversation, eq(conversation.id, agreement.conversationId))
    .innerJoin(participant, eq(participant.id, agreement.proposedBy))
    .where(eq(agreement.workspaceId, workspaceId))
    .orderBy(desc(agreement.createdAt));
}

/**
 * Цитаты с номером сообщения и именем того, кто его написал.
 *
 * Номер, а не только идентификатор: лента листается номерами, и без него
 * «перейти к реплике» неисполнимо. Имя — это «кто попросил» из бизнес-ТЗ,
 * и это автор РЕПЛИКИ, а не автор предложения: их легко перепутать,
 * потому что предложение пишет агент, а обещание давал человек.
 */
export async function citationsFor(tx: Executor, agreementIds: string[]) {
  if (agreementIds.length === 0) return [];
  return tx
    .select({
      agreementId: citation.agreementId,
      messageId: citation.messageId,
      quote: citation.quote,
      seq: message.seq,
      authorName: participant.displayName,
    })
    .from(citation)
    .innerJoin(message, eq(message.id, citation.messageId))
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .where(inArray(citation.agreementId, agreementIds));
}

/** Задача из договорённости. Повторное подтверждение второй не заводит. */
export async function insertTask(
  tx: Executor,
  input: {
    workspaceId: string;
    title: string;
    /** Пусто — задачу завели руками, без договорённости. */
    agreementId?: string | null;
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
  patch: { status?: string; assignedTo?: string | null; responsibleId?: string },
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
      agreementId: task.agreementId,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      conversationId: agreement.conversationId,
      conversationTitle: conversation.title,
      assignedToId: doer.id,
      assignedToName: doer.displayName,
      assignedToKind: doer.kind,
      responsibleId: owner.id,
      responsibleName: owner.displayName,
    })
    .from(task)
    .leftJoin(agreement, eq(agreement.id, task.agreementId))
    .leftJoin(conversation, eq(conversation.id, agreement.conversationId))
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
