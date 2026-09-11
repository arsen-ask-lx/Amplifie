import { mentionedIds } from "@amplifie/contract";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { requireVisible, type Viewer } from "./access.js";
import { canSee } from "./repo.js";
import { conversation, message, messageMention } from "./schema.js";
import { unseenBy } from "./unread.js";

/**
 * Упоминания: кого позвали, кого звать можно и куда вести кнопку перехода
 * (Р-031).
 *
 * ⚠️ СВОЙ ФАЙЛ, ПОТОМУ ЧТО ЭТО СВОЙ ВОПРОС. `repo.ts` отвечает на «как
 * лежат разговоры и реплики», `service.ts` — на «что можно сделать
 * с разговором»; здесь — «кого в нём зовут». Дописанное к соседям, это
 * знание расползлось бы по двум файлам, каждый из которых и без того
 * упёрся в предел размера.
 *
 * Само число упоминаний считается в `unread.ts`: оно едет вместе
 * со списком разговоров одним запросом.
 */

/**
 * Кто видит этот разговор — то есть кого в нём можно позвать (Р-031).
 *
 * Тот же вопрос, что у `visibleTo`, заданный с другой стороны, — и ответ
 * на него даёт ТО ЖЕ правило (`canSee`), а не своя копия. Своя копия
 * здесь уже была и расходилась с первой: одна читала видимость корня,
 * другая — ветки (task-039).
 */
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

/**
 * Кого позвали в этом сообщении — переписать список целиком.
 *
 * ⚠️ ИМЕННО ПЕРЕПИСАТЬ, А НЕ ДОПИСАТЬ. Правка сообщения меняет и то, кого
 * в нём зовут: убрал упоминание — значка у человека остаться не должно.
 * Дописывание копило бы зовы, которых в тексте больше нет, и счётчик
 * начал бы врать в сторону «тебя звали», то есть в самую заметную.
 */
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
 * Номер самого раннего неувиденного упоминания — куда ведёт кнопка перехода.
 *
 * Самого раннего, а не ближайшего к концу: человек идёт к первому, что
 * пропустил, и дальше читает вперёд. Так же ведёт себя кнопка у Телеграма
 * (`minLoaded` в их `CornerButtons::mentionsClick`).
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
 * Позвали того, кто этого разговора не видит (Р-031).
 *
 * ⚠️ ОТКАЗ, А НЕ ТИХОЕ ВЫБРАСЫВАНИЕ УПОМИНАНИЯ. Молча убрать зов
 * значило бы: автор видит в своём тексте имя коллеги, уверен, что позвал,
 * а тот не получил ничего. Ошибка, которую никто не заметит, — худший
 * исход из возможных; пусть лучше отправка не пройдёт.
 */
export class MentionNotAllowedError extends Error {}

/**
 * Кого зовут в этом теле — и имеет ли право звать.
 *
 * ⚠️ ПРАВА ПРОВЕРЯЮТСЯ ЗДЕСЬ, А НЕ НА ВИТРИНЕ. Номер участника приходит
 * от клиента, то есть это недоверенный ввод ровно как цитата: без
 * проверки можно было бы позвать кого угодно из чужого пространства
 * и узнать его имя обратным ответом. Тот же рубеж, что у `replyToId`.
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

/**
 * Кого можно позвать в этом разговоре (Р-031).
 *
 * ⚠️ СЕБЯ В СПИСКЕ НЕТ. Сам себя не зовут: собственное упоминание
 * не считается счётчиком, и предлагать его — значит предлагать
 * действие, которое ничего не сделает.
 */
export async function peopleToMention(viewer: Viewer, conversationId: string) {
  await requireVisible(db, viewer, conversationId);
  const everyone = await peopleWhoSee(db, conversationId);
  return everyone
    .filter((one) => one.id !== viewer.participantId)
    .map((one) => ({ id: one.id, name: one.name, kind: one.kind }));
}

/**
 * Куда вести кнопку перехода к упоминанию — номер самого раннего
 * неувиденного зова либо `null`, если идти некуда.
 */
export async function whereMentioned(
  viewer: Viewer,
  conversationId: string,
): Promise<{ seq: number | null }> {
  await requireVisible(db, viewer, conversationId);
  return { seq: await nearestMention(db, conversationId, viewer.participantId) };
}
