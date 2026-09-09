import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, type SQL, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";
import { conversation, conversationMember, message } from "./schema.js";

/** Слой хранилища модуля talk. Только запросы, никакой логики. */

/**
 * Следующий номер в пространстве.
 *
 * Блокировка строки пространства выстраивает записи в очередь, поэтому номер
 * выдаётся в порядке ФИКСАЦИИ и без дыр. Вызывать только внутри транзакции,
 * которая тут же пишет объект с этим номером.
 */
export async function nextSeq(tx: Executor, workspaceId: string): Promise<number> {
  const rows = await tx
    .update(workspace)
    .set({ lastSeq: sql`${workspace.lastSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ seq: workspace.lastSeq });
  const row = rows[0];
  if (!row) throw new Error("пространство не найдено");
  return Number(row.seq);
}

/**
 * Разговор, видимый данному участнику. Одним запросом, а не двумя.
 *
 * Право читается у КОРНЯ дерева: у ветки своих участников нет
 * (dock/06-разбор-мессенджеров.md). Соединение по COALESCE(parent_id, id)
 * и есть «подняться к корню».
 *
 * Не найдено и не видно — оба случая дают null: наружу это одна и та же
 * ошибка, иначе по ответу перебирают существующие разговоры.
 */
/**
 * ЕДИНСТВЕННОЕ условие видимости (Р-010). Всё, что спрашивает «можно ли
 * это читать», обязано спрашивать здесь — иначе ответов станет два.
 *
 * Два повода сказать «да», но арбитр по-прежнему один:
 *   ① канал открыт всему пространству, и участник — из этого пространства;
 *   ② есть строка членства в КОРНЕ дерева (ветка своих участников не имеет).
 *
 * Членство при этом продолжает отвечать на свой отдельный вопрос —
 * «канал у меня в списке», см. listConversationsFor.
 */
function visibleTo(participantId: string) {
  const rootOf = sql`COALESCE(${conversation.parentId}, ${conversation.id})`;

  const openToMyWorkspace = sql`
    ${conversation.visibility} = 'workspace'
    AND ${conversation.workspaceId} = (
      SELECT ${participant.workspaceId} FROM ${participant}
      WHERE ${participant.id} = ${participantId}
    )`;

  const iAmMemberOfRoot = sql`EXISTS (
    SELECT 1 FROM ${conversationMember}
    WHERE ${conversationMember.conversationId} = ${rootOf}
      AND ${conversationMember.participantId} = ${participantId}
  )`;

  // ⚠️ УДАЛЁННЫЙ КАНАЛ НЕВИДИМ, И ЭТО СКАЗАНО ЗДЕСЬ, А НЕ В КАЖДОМ ЗАПРОСЕ.
  // Видимость — один вопрос и одно место, где на него отвечают. Условие,
  // размазанное по вызывающим, однажды не поставится в одном из них,
  // и удалённый канал вернётся к жизни в каком-нибудь углу.
  //
  // Удалённой считается и ВЕТКА удалённого корня: право читается у корня,
  // значит и смерть — тоже у корня.
  const rootAlive = sql`NOT EXISTS (
    SELECT 1 FROM ${conversation} AS root
    WHERE root.id = ${rootOf} AND root.deleted_at IS NOT NULL
  )`;

  // ⚠️ ВНЕШНИЕ СКОБКИ ОБЯЗАТЕЛЬНЫ. Без них `and(eq(id, ...), visibleTo(...))`
  // склеивается в `id = $1 AND A OR B`, а по приоритету это `(id = $1 AND A)
  // OR B` — и доступ начинает давать членство в ЛЮБОМ другом разговоре.
  // Так и было: чужой канал открывался тому, у кого есть свой.
  // Найдено приёмочным тестом «чужой канал не виден и не читается».
  return sql`(${rootAlive} AND ((${openToMyWorkspace}) OR (${iAmMemberOfRoot})))`;
}

export async function findVisibleConversation(
  tx: Executor,
  conversationId: string,
  participantId: string,
) {
  const rows = await tx
    .select({
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      kind: conversation.kind,
      parentId: conversation.parentId,
      title: conversation.title,
      visibility: conversation.visibility,
    })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), visibleTo(participantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertConversation(
  tx: Executor,
  input: {
    workspaceId: string;
    kind: string;
    title: string;
    parentId?: string | null;
    visibility?: string;
  },
) {
  const rows = await tx
    .insert(conversation)
    .values({ ...input, parentId: input.parentId ?? null })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать разговор");
  return row;
}

export async function insertMember(
  tx: Executor,
  input: { conversationId: string; participantId: string; workspaceId: string; role?: string },
) {
  await tx.insert(conversationMember).values(input);
}

/** Разговоры, где участник состоит, плюс их ветки. */
/**
 * Список разговоров — по свежести (Р-011).
 *
 * Порядок по последней активности решает большую часть задачи «сто
 * каналов» сам по себе: в работе человеку почти всегда нужны те же
 * три-пять мест, и они всплывают наверх без всякой раскладки по папкам.
 *
 * Разговор без сообщений не проваливается вниз навсегда: за неимением
 * последнего сообщения берётся время создания. Иначе только что заведённый
 * канал оказывался бы в самом хвосте — там, где его никто не найдёт.
 */
/**
 * Сколько чужих реплик человек ещё не видел в НАЗВАННОМ разговоре.
 *
 * ⚠️ СЧИТАЕТСЯ, А НЕ ХРАНИТСЯ (Р-029). Хранимое число — второй источник
 * правды о том же факте, и оно разойдётся с репликами при первом же
 * удалении. Индекс `(conversation_id, seq)` для этого счёта уже есть.
 *
 * ⚠️ СВОИ РЕПЛИКИ НЕ СЧИТАЮТСЯ. Автор уже видел то, что написал, —
 * иначе счётчик рос бы от собственного письма.
 *
 * ⚠️ ПОТОЛОК В ТЫСЯЧУ, И ОН НЕ ДЛЯ КРАСОТЫ. Выше тысячи число на экране
 * всё равно показывается как «999+», а `LIMIT` внутри превращает счёт
 * по огромному каналу в счёт по первой тысяче строк индекса.
 */
const UNREAD_CAP = 1000;

/**
 * Ссылка на разговор ИЗ ВЛОЖЕННОГО запроса, написанная именем таблицы.
 *
 * ⚠️ БЕЗ ЭТОГО СВЯЗАННЫЙ ПОДЗАПРОС МОЛЧА СЧИТАЕТ НЕ ТО, и мы на этом
 * уже обожглись дважды в одном файле. Внутри списка выбираемых полей
 * drizzle печатает колонку БЕЗ имени таблицы: `${conversation.id}`
 * превращается в `"id"`. А внутри `SELECT ... FROM "message"` имя `"id"`
 * означает `message.id`, потому что у реплики своя колонка `id`.
 * Условие `"conversation_id" = "id"` становится
 * `message.conversation_id = message.id` — вечная ложь.
 *
 * Ошибка не падает и не логируется: подзапрос честно возвращает пусто.
 * Непрочитанное показывалось нулём всегда; время последней активности
 * рядом — временем СОЗДАНИЯ разговора, то есть список каналов никогда
 * не сортировался по свежести. Второе жило в коде месяц и найдено
 * попутно (см. лог task-024).
 *
 * `sql.raw` здесь — не грубость, а единственный способ сказать «именно
 * та таблица снаружи»: имя разговора в этом файле одно и не меняется.
 */
const ЭТОТ_РАЗГОВОР = sql.raw('"conversation"."id"');

function unreadOf(conversationId: PgColumn | SQL | string, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT 1 FROM ${message}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${message.authorParticipantId} <> ${participantId}
        AND ${message.deletedAt} IS NULL
        AND ${message.seq} > COALESCE((
          SELECT ${conversationMember.readSeq} FROM ${conversationMember}
          WHERE ${conversationMember.conversationId} = ${conversationId}
            AND ${conversationMember.participantId} = ${participantId}
        ), 0)
      LIMIT ${UNREAD_CAP}
    ) AS невидённые
  )`;
}

export async function listConversationsFor(tx: Executor, participantId: string) {
  const lastAt = sql<Date>`GREATEST(
    ${conversation.createdAt},
    COALESCE((
      SELECT MAX(${message.createdAt}) FROM ${message}
      WHERE ${message.conversationId} = ${ЭТОТ_РАЗГОВОР}
    ), ${conversation.createdAt})
  )`;

  return tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      parentId: conversation.parentId,
      lastAt,
      unread: unreadOf(ЭТОТ_РАЗГОВОР, participantId),
      /**
       * Докуда человек дочитал. Едет наружу вместе со счётчиком, потому
       * что число отвечает на «сколько», а черта «Непрочитанные
       * сообщения» — на «откуда», и второго из первого не вывести:
       * клиент держит только окно ленты. У Телеграма рядом с
       * `unread_count` по той же причине лежит `read_inbox_max_id`.
       *
       * Ноль у того, кто в разговоре не состоит: он видит его по
       * открытости пространству, а своей отметки у него нет.
       */
      readSeq: sql<number>`COALESCE((
        SELECT ${conversationMember.readSeq} FROM ${conversationMember}
        WHERE ${conversationMember.conversationId} = ${ЭТОТ_РАЗГОВОР}
          AND ${conversationMember.participantId} = ${participantId}
      ), 0)`,
    })
    .from(conversation)
    .where(visibleTo(participantId))
    .orderBy(desc(lastAt));
}

/**
 * Непрочитанное в одном разговоре — после отметки.
 *
 * ⚠️ ЧЕРЕЗ `select`, А НЕ ЧЕРЕЗ `execute`, И ЭТО НЕ ВКУСОВЩИНА. Сперва
 * здесь стоял `tx.execute(sql...)` — он возвращает не список строк,
 * а ответ драйвера целиком, и чтение `[0]` давало `undefined`. Счётчик
 * молча оказывался нулём: ни ошибки, ни исключения, просто «всё
 * прочитано». Ровно тот отказ, от которого мы защищаемся всей задачей.
 *
 * Теперь путь один и тот же, что у списка разговоров, — значит и ломаться
 * им предстоит вместе, а не по отдельности.
 */
export async function countUnread(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: unreadOf(conversationId, participantId) })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.participantId, participantId),
      ),
    )
    .limit(1);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Отметить прочитанным всё до номера включительно.
 *
 * ⚠️ ТОЛЬКО ВПЕРЁД, И ЭТО ГЛАВНАЯ СТРОКА ВСЕЙ ЗАТЕИ. `GREATEST` вместо
 * присваивания — защита от того, что две вкладки одного человека шлют
 * «дочитал» вразнобой: первая долистала до конца, вторая стояла на
 * старом месте и отправила свой номер ПОЗЖЕ. Присваивание откатило бы
 * прочитанное, и непрочитанное воскресло бы само (Р-029).
 *
 * Отметить прочитанным то, чего человек не видел, нечем отменить —
 * поэтому откат запрещён базой, а не порядком вызовов.
 *
 * Возвращает `false`, если участника в разговоре нет: это и есть проверка
 * права, сделанная самим `UPDATE`, а не отдельным чтением до него.
 */
export async function markRead(
  tx: Executor,
  conversationId: string,
  participantId: string,
  seq: number,
): Promise<boolean> {
  const rows = await tx
    .update(conversationMember)
    .set({ readSeq: sql`GREATEST(${conversationMember.readSeq}, ${seq})` })
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.participantId, participantId),
      ),
    )
    .returning({ readSeq: conversationMember.readSeq });
  return rows.length > 0;
}

/**
 * Мягко удалить разговор.
 *
 * Условие «ещё не удалён» стоит в самом запросе, а не проверкой до него:
 * два вызова подряд не должны дважды двигать отметку времени, и решать
 * это должна база, а не порядок вызовов.
 */
export async function softDeleteConversation(tx: Executor, conversationId: string) {
  const rows = await tx
    .update(conversation)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversation.id, conversationId), isNull(conversation.deletedAt)))
    .returning({ id: conversation.id });
  return rows[0] ?? null;
}

/** Роль участника в разговоре. `null` — участника там нет вовсе. */
export async function roleIn(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ role: conversationMember.role })
    .from(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.participantId, participantId),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

export async function findMessageByClientId(
  tx: Executor,
  conversationId: string,
  clientMsgId: string,
) {
  const rows = await tx
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.clientMsgId, clientMsgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertMessage(
  tx: Executor,
  input: {
    workspaceId: string;
    conversationId: string;
    authorParticipantId: string;
    body: string;
    clientMsgId: string;
    seq: number;
    kind?: string;
    trust?: string;
    replyToId?: string | null;
    forwardedFromId?: string | null;
  },
) {
  // ⚠️ НОМЕР ИЗМЕНЕНИЯ У НОВОЙ РЕПЛИКИ РАВЕН НОМЕРУ СКАЗАННОГО, и это
  // ставится ЗДЕСЬ, а не на вызывающей стороне. Пусть о втором номере
  // знает одно место: два места однажды разойдутся, и разойдутся молча —
  // реплика просто перестанет доезжать.
  const rows = await tx
    .insert(message)
    .values({ ...input, updatedSeq: input.seq })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось записать сообщение");
  return row;
}

/**
 * Отметка «эта реплика только что изменилась».
 *
 * ⚠️ ЕДИНСТВЕННОЕ МЕСТО, ГДЕ БЕРЁТСЯ НОМЕР ИЗМЕНЕНИЯ. Правка, удаление
 * и закрепление — разные действия, но для догона они одно и то же
 * событие: «эту реплику надо отдать заново». Три отдельных вызова
 * `nextSeq` в трёх местах — это три возможности забыть один из них,
 * и забытый не проявится ни в типах, ни в тестах соседних свойств.
 *
 * Номер берётся из того же счётчика пространства, что и `seq`: один
 * счётчик — один курсор у клиента.
 */
async function changed(tx: Executor, workspaceId: string): Promise<{ updatedSeq: number }> {
  return { updatedSeq: await nextSeq(tx, workspaceId) };
}

/**
 * Цитируемое сообщение и его автор — теми же таблицами, но под другими
 * именами (`alias`). Без псевдонима присоединить таблицу к самой себе
 * нельзя: два `message` в одном запросе неразличимы.
 */
const quoted = alias(message, "quoted");
const quotedAuthor = alias(participant, "quoted_author");
const source = alias(message, "source");
const sourceAuthor = alias(participant, "source_author");

/**
 * Единственный список полей сообщения. Все выборки берут его.
 *
 * ⚠️ ЦИТАТА ХРАНИТСЯ ССЫЛКОЙ, А ТЕКСТ ЧИТАЕТСЯ ПРИСОЕДИНЕНИЕМ. Копировать
 * кусок цитируемого текста в само сообщение было бы дешевле в чтении
 * и неверно по сути: правка исходной реплики не дошла бы до цитаты,
 * и две записи одного и того же разошлись бы навсегда.
 *
 * ⚠️ ЛЕВОЕ присоединение, а не внутреннее. Цитата не обязана существовать:
 * ссылка обнуляется при удалении исходной реплики, и внутреннее
 * присоединение выкинуло бы из ленты сам ответ — то есть чужие слова.
 */
const MESSAGE_VIEW = {
  id: message.id,
  /**
   * Ключ, выданный КЛИЕНТОМ при наборе.
   *
   * ⚠️ ОТДАЁТСЯ НАРУЖУ НАМЕРЕННО. Он уже существует как ключ
   * идемпотентности, и он — единственное, что связывает показанный
   * на экране черновик с записанной репликой. Без него клиент считает
   * их разными: строка на экране уничтожается и создаётся заново,
   * а вместе с ней перезапускается всё, что к ней привязано, — от
   * появления до выделенного мышью текста.
   */
  clientMsgId: message.clientMsgId,
  conversationId: message.conversationId,
  body: message.body,
  kind: message.kind,
  seq: message.seq,
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  pinnedAt: message.pinnedAt,
  // Нужно догону, чтобы отличить живую реплику от надгробия. В ленту
  // не попадает: вид сообщения собирает `presentMessage`.
  deletedAt: message.deletedAt,
  authorId: participant.id,
  authorName: participant.displayName,
  authorKind: participant.kind,
  replyToId: quoted.id,
  replyToSeq: quoted.seq,
  replyToBody: quoted.body,
  /**
   * Удалена ли цитируемая реплика.
   *
   * ⚠️ БЕЗ ЭТОГО ПОЛЯ ЦИТАТА НА УДАЛЁННОЕ ПОКАЗЫВАЛА ПУСТУЮ РАМКУ.
   * Ссылка в базе объявлена `ON DELETE SET NULL`, но удаление у нас
   * МЯГКОЕ: строка остаётся, ссылка тоже, а тело становится пустым.
   * Проверка «тела нет» на это не срабатывала: пустая строка — не `null`.
   */
  replyToDeletedAt: quoted.deletedAt,
  replyToAuthorName: quotedAuthor.displayName,
  forwardedFromAuthorName: sourceAuthor.displayName,
} as const;

/**
 * Вид одного сообщения по идентификатору.
 *
 * Нужен там, где сообщение уже записано или уже существовало: строить вид,
 * выбирая «последние N» и разыскивая среди них нужное, — ошибка, из-за
 * которой у повтора терялся автор (найдено 2026-09-06).
 */
export async function findMessageViewById(tx: Executor, messageId: string) {
  const rows = await tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    .where(eq(message.id, messageId))
    .limit(1);
  return rows[0] ?? null;
}

/** Сама запись сообщения без вида — для проверок «моё ли, тут ли». */
export async function findMessage(tx: Executor, messageId: string) {
  const rows = await tx.select().from(message).where(eq(message.id, messageId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Правка тела. Отметка «изменено» ставится здесь и только здесь: разнесённая
 * по вызывающим, она однажды не поставится, и лента соврёт.
 */
export async function updateMessageBody(
  tx: Executor,
  workspaceId: string,
  messageId: string,
  body: string,
) {
  const rows = await tx
    .update(message)
    .set({ body, editedAt: new Date(), ...(await changed(tx, workspaceId)) })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id });
  return rows[0] ?? null;
}

/** Мягкое удаление: тело стирается, строка остаётся ради ссылок на неё. */
export async function softDeleteMessage(tx: Executor, workspaceId: string, messageId: string) {
  /**
   * ⚠️ ОДИН НОМЕР НА ВСЁ УДАЛЕНИЕ, А НЕ ПО НОМЕРУ НА СТРОКУ. Удаление —
   * одно изменение пространства, даже когда оно задевает несколько
   * реплик. Счётчик пространства сериализует записи (Д-2), и брать
   * из него лишние номера значит платить за то, что никому не нужно:
   * догон отбирает по `>` и `<=`, совпадающие номера ему безразличны.
   */
  const mark = await changed(tx, workspaceId);

  const rows = await tx
    .update(message)
    // Тело стирается, а не остаётся «на всякий случай»: удалённое сообщение
    // не должно читаться ни из базы, ни из выгрузки.
    .set({ deletedAt: new Date(), body: "", ...mark })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id, conversationId: message.conversationId });

  if (!rows[0]) return null;

  /**
   * ⚠️ ОТВЕТЫ НА УДАЛЁННОЕ ТОЖЕ СЧИТАЮТСЯ ИЗМЕНИВШИМИСЯ (Д-20).
   *
   * Цитата живёт НЕ в ответе, а собирается присоединением к цитируемой
   * реплике. Стоит той исчезнуть — ответ выглядит иначе, хотя сам он
   * не менялся ни на знак. Для догона «изменилось» значит «человек
   * увидит другое», а не «в строке другие байты».
   *
   * Без этой правки открытая вкладка продолжала показывать цитату из
   * удалённого: догон о ней не рассказывал, а перезагрузка страницы
   * «чинила» — первичная загрузка про удаление знает. Поломка, которую
   * не воспроизвести, если не знать.
   */
  await tx
    .update(message)
    .set(mark)
    .where(and(eq(message.replyToId, messageId), isNull(message.deletedAt)));

  return rows[0];
}

/** Закрепить или открепить. `null` снимает отметку. */
export async function setPinned(
  tx: Executor,
  workspaceId: string,
  messageId: string,
  at: Date | null,
) {
  const rows = await tx
    .update(message)
    .set({ pinnedAt: at, ...(await changed(tx, workspaceId)) })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id });
  return rows[0] ?? null;
}

/** Закреплённые разговора, свежие сверху. Их единицы — предел не нужен. */
export async function listPinned(tx: Executor, conversationId: string) {
  return tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    .where(
      and(
        eq(message.conversationId, conversationId),
        isNotNull(message.pinnedAt),
        isNull(message.deletedAt),
      ),
    )
    .orderBy(desc(message.pinnedAt));
}

/**
 * Лента разговора: последние N, отдаются по возрастанию номера.
 *
 * `before` — номер, СТРОГО старше которого нужна страница. Курсор по
 * значению, а не смещение: смещение съезжает, когда во время листания
 * приходит новое сообщение, и страницы начинают и повторяться, и пропадать.
 */
export async function listMessages(
  tx: Executor,
  conversationId: string,
  limit: number,
  before?: number,
) {
  const rows = await tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    // ⚠️ Удалённые не отдаются НИ ЗДЕСЬ, НИ В ДОГОНЕ. Забыть одно из двух
    // мест — главный способ провалить мягкое удаление: реплика исчезает
    // из ленты и возвращается первым же обновлением.
    .where(
      and(
        eq(message.conversationId, conversationId),
        isNull(message.deletedAt),
        before === undefined ? undefined : lt(message.seq, before),
      ),
    )
    .orderBy(desc(message.seq))
    .limit(limit);
  return rows.reverse();
}

/**
 * Догон: всё, что появилось в пространстве после номера — но только в тех
 * разговорах, где участник состоит. Проверка членства идёт по КОРНЮ.
 *
 * Выборка ограничена сверху `upToSeq` — той самой границей, которую получит
 * клиент. Без верхней границы это два разных снимка базы: сообщение,
 * зафиксированное между чтением ленты и чтением границы, в ответ не попадёт,
 * а курсор клиента через него перепрыгнет. Проверено опытом: под нагрузкой
 * так терялось около 6% сообщений — навсегда.
 */
export async function listMessagesAfter(
  tx: Executor,
  workspaceId: string,
  participantId: string,
  afterSeq: number,
  upToSeq: number,
  limit: number,
) {
  return (
    tx
      .select(MESSAGE_VIEW)
      .from(message)
      .innerJoin(participant, eq(participant.id, message.authorParticipantId))
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .leftJoin(quoted, eq(quoted.id, message.replyToId))
      .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
      .leftJoin(source, eq(source.id, message.forwardedFromId))
      .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
      .where(
        and(
          eq(message.workspaceId, workspaceId),
          // ⚠️ ОТБОР ПО НОМЕРУ ИЗМЕНЕНИЯ, А НЕ ПО НОМЕРУ СКАЗАННОГО. Именно
          // в этой строке жила поломка: правка не двигала `seq`, и
          // исправленная реплика в догон не попадала никогда.
          gt(message.updatedSeq, afterSeq),
          lte(message.updatedSeq, upToSeq),
          // ⚠️ УДАЛЁННЫЕ БОЛЬШЕ НЕ ОТСЕКАЮТСЯ. «Нет в ответе» у догона
          // означает «не менялось»; из молчания вкладка, которая держит
          // реплику на экране, ничего не узнает. Удалённая приезжает
          // надгробием — текст с неё снимает `presentMessage`.
          visibleTo(participantId),
        ),
      )
      // Порядок ответа — по номеру изменения. Место реплики в разговоре
      // клиент берёт из `seq`, а не из порядка, в котором её отдали.
      .orderBy(asc(message.updatedSeq))
      .limit(limit)
  );
}

/** Текущий номер пространства — верхняя граница догона. */
export async function currentSeq(tx: Executor, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ seq: workspace.lastSeq })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return Number(rows[0]?.seq ?? 0);
}
