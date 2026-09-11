import { mentionedIds } from "@amplifie/contract";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { requireVisible, type Viewer } from "./access.js";
import { canSee } from "./repo.js";
import { conversation, message, messageMention } from "./schema.js";
import { unseenBy } from "./unread.js";

/**
 * Упоминания: кого позвали, кого звать можно, куда вести кнопку (Р-031).
 * Число упоминаний считается в `unread.ts` вместе со списком разговоров.
 */

/** Кто видит разговор, то есть кого можно позвать — тем же правилом `canSee`. */
async function peopleWhoSee(
  tx: Executor,
  conversationId: string,
): Promise<{ id: string; name: string; kind: string }[]> {
  const found = await tx
    .select({ workspaceId: conversation.workspaceId, parentId: conversation.parentId })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .limit(1);
  const row = found[0];
  if (!row) return [];

  return tx
    .select({ id: participant.id, name: participant.displayName, kind: participant.kind })
    .from(participant)
    .where(
      and(
        eq(participant.workspaceId, row.workspaceId),
        canSee(sql`${conversationId}::uuid`, sql`${row.parentId}::uuid`, participant.id),
      ),
    )
    .orderBy(asc(participant.displayName));
}

/** Кого позвали в сообщении — переписать целиком: правка может убрать зов. */
export async function setMentions(
  tx: Executor,
  messageId: string,
  participantIds: readonly string[],
): Promise<void> {
  await tx.delete(messageMention).where(eq(messageMention.messageId, messageId));
  if (participantIds.length === 0) return;
  await tx
    .insert(messageMention)
    .values(participantIds.map((participantId) => ({ messageId, participantId })));
}

/**
 * Самое раннее неувиденное упоминание — к первому пропущенному, дальше
 * читают вперёд (как `CornerButtons::mentionsClick` у Телеграма).
 */
async function nearestMention(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<number | null> {
  const rows = await tx
    .select({ seq: message.seq })
    .from(message)
    .innerJoin(messageMention, eq(messageMention.messageId, message.id))
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(messageMention.participantId, participantId),
        unseenBy(conversationId, participantId),
      ),
    )
    .orderBy(asc(message.seq))
    .limit(1);
  return rows[0] ? Number(rows[0].seq) : null;
}

/**
 * Позвали того, кто разговора не видит (Р-031). Отказ, а не тихий выброс:
 * автор видит имя в тексте и уверен, что позвал.
 */
export class MentionNotAllowedError extends Error {}

/**
 * Кого зовут в теле — и вправе ли. Номер участника пришёл от клиента:
 * без проверки звали бы людей чужого пространства и узнавали их имена.
 */
export async function mentionedWhoSee(
  tx: Executor,
  conversationId: string,
  body: string,
): Promise<string[]> {
  const mentioned = mentionedIds(body);
  if (mentioned.length === 0) return [];

  const seers = new Set((await peopleWhoSee(tx, conversationId)).map((one) => one.id));
  const stranger = mentioned.find((id) => !seers.has(id));
  if (stranger) {
    throw new MentionNotAllowedError("позвали того, кто не видит этот разговор");
  }
  return mentioned;
}

/** Кого можно позвать (Р-031). Себя в списке нет: свой зов ничего не делает. */
export async function peopleToMention(viewer: Viewer, conversationId: string) {
  await requireVisible(db, viewer, conversationId);
  const everyone = await peopleWhoSee(db, conversationId);
  return everyone
    .filter((one) => one.id !== viewer.participantId)
    .map((one) => ({ id: one.id, name: one.name, kind: one.kind }));
}

/** Куда вести кнопку перехода к упоминанию; `null` — некуда. */
export async function whereMentioned(
  viewer: Viewer,
  conversationId: string,
): Promise<{ seq: number | null }> {
  await requireVisible(db, viewer, conversationId);
  return { seq: await nearestMention(db, conversationId, viewer.participantId) };
}
