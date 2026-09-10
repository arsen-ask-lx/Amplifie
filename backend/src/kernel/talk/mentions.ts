import { mentionedIds } from "@amplifie/contract";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { requireVisible, type Viewer } from "./access.js";
import {
  conversation,
  conversationMember,
  conversationRead,
  message,
  messageMention,
} from "./schema.js";

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
 * Само число упоминаний считается не здесь, а в `repo.ts`: оно едет
 * вместе со списком разговоров одним запросом, и разлучать их значило бы
 * ходить в базу дважды за одним экраном.
 */

/**
 * Кто видит этот разговор — то есть кого в нём можно позвать (Р-031).
 *
 * ⚠️ ВОПРОС ТОТ ЖЕ, ЧТО У `visibleTo`, НО ЗАДАН С ДРУГОЙ СТОРОНЫ.
 * Там «какие разговоры видит вот этот человек», здесь «какие люди видят
 * вот этот разговор». Отвечать на второй перебором первого — значит
 * задать по запросу на каждого участника пространства.
 *
 * Право читается у КОРНЯ дерева: у ветки своих участников нет, она
 * наследует видимость канала (dock/06-разбор-мессенджеров.md).
 */
async function peopleWhoSee(
  tx: Executor,
  conversationId: string,
): Promise<{ id: string; name: string; kind: string }[]> {
  const корни = await tx
    .select({
      root: sql<string>`COALESCE(${conversation.parentId}, ${conversation.id})`,
      workspaceId: conversation.workspaceId,
    })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), isNull(conversation.deletedAt)))
    .limit(1);
  const это = корни[0];
  if (!это) return [];

  const открыт = sql`EXISTS (
    SELECT 1 FROM ${conversation} AS root
    WHERE root.id = ${это.root} AND root.visibility = 'workspace'
  )`;
  const состоит = sql`EXISTS (
    SELECT 1 FROM ${conversationMember}
    WHERE ${conversationMember.conversationId} = ${это.root}
      AND ${conversationMember.participantId} = ${participant.id}
  )`;

  return tx
    .select({ id: participant.id, name: participant.displayName, kind: participant.kind })
    .from(participant)
    .where(and(eq(participant.workspaceId, это.workspaceId), sql`(${открыт} OR ${состоит})`))
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
        sql`${message.authorParticipantId} <> ${participantId}`,
        isNull(message.deletedAt),
        sql`${message.seq} > COALESCE((
          SELECT ${conversationRead.readSeq} FROM ${conversationRead}
          WHERE ${conversationRead.conversationId} = ${conversationId}
            AND ${conversationRead.participantId} = ${participantId}
        ), 0)`,
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
export async function зовущиеся(
  tx: Executor,
  conversationId: string,
  body: string,
): Promise<string[]> {
  const позваны = mentionedIds(body);
  if (позваны.length === 0) return [];

  const видят = new Set((await peopleWhoSee(tx, conversationId)).map((one) => one.id));
  const чужой = позваны.find((id) => !видят.has(id));
  if (чужой) {
    throw new MentionNotAllowedError("позвали того, кто не видит этот разговор");
  }
  return позваны;
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
  const все = await peopleWhoSee(db, conversationId);
  return все
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
