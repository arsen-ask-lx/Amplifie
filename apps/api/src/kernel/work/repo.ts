import { and, desc, eq, inArray } from "drizzle-orm";
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
  input: { workspaceId: string; agreementId: string; title: string },
) {
  const rows = await tx.insert(task).values(input).onConflictDoNothing().returning();
  return rows[0] ?? null;
}

/** Задачи вместе с разговором, из которого они родились (К5). */
export async function listTasksIn(tx: Executor, workspaceId: string) {
  return tx
    .select({
      id: task.id,
      agreementId: task.agreementId,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      conversationId: agreement.conversationId,
      conversationTitle: conversation.title,
    })
    .from(task)
    .innerJoin(agreement, eq(agreement.id, task.agreementId))
    .innerJoin(conversation, eq(conversation.id, agreement.conversationId))
    .where(eq(task.workspaceId, workspaceId))
    .orderBy(desc(task.createdAt));
}
