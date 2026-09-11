import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";
import { conversation, conversationMember, conversationRead, message, pin } from "./schema.js";
import { mentionsOf, unreadOf } from "./unread.js";

/**
 * Слой хранилища модуля talk. Только запросы, никакой логики.
 *
 * Непрочитанное живёт рядом, в `unread.ts`, и отдаётся отсюда же:
 * для службы хранилище одно, как бы оно ни было разложено по файлам.
 */
export { countUnread, markRead } from "./unread.js";

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
 * ЕДИНСТВЕННОЕ правило видимости (Р-010): разговор виден человеку.
 *
 * Всё читается у КОРНЯ — видимость, пространство, удалённость и членство:
 * у ветки своих прав нет. Прежде видимость читалась у самой ветки, и ветка
 * закрытого канала (у неё значение по умолчанию «всем») была видна всему
 * пространству (task-027 №1, task-039).
 *
 * Два поворота одного правила — «что видит этот человек» (`visibleTo`)
 * и «кто видит этот разговор» (`mentions.ts`) — оба зовут эту функцию:
 * два способа сказать одно о правах однажды расходятся, и уже разошлись.
 *
 * Внутри — псевдонимы `root` и `asker`, а не имена таблиц: правило
 * вставляется в запросы, где `conversation` и `participant` уже заняты
 * внешней строкой, и без псевдонима условие молча сравнило бы строку
 * саму с собой.
 */
export function canSee(
  conversationId: SQLWrapper,
  parentId: SQLWrapper,
  participantId: SQLWrapper | string,
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${conversation} AS root
    WHERE root.id = COALESCE(${parentId}, ${conversationId})
      AND root.deleted_at IS NULL
      AND (
        (root.visibility = 'workspace' AND root.workspace_id = (
          SELECT asker.workspace_id FROM ${participant} AS asker WHERE asker.id = ${participantId}
        ))
        OR EXISTS (
          SELECT 1 FROM ${conversationMember} AS m
          WHERE m.conversation_id = root.id AND m.participant_id = ${participantId}
        )
      )
  )`;
}

/** Разговоры (строки `conversation` запроса), видимые этому человеку. */
export function visibleTo(participantId: string): SQL {
  return canSee(conversation.id, conversation.parentId, participantId);
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
      // Нужен области чтения агента: у чата вне проекта она — он сам.
      projectId: conversation.projectId,
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
const THIS_CONVERSATION = sql.raw('"conversation"."id"');

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
 * Закреплённое человеком идёт первым (task-038). Вместе со строками
 * едут счётчики непрочитанного и упоминаний.
 *
 * ⚠️ НЕ `async`, И ЭТО НАМЕРЕННО. Возвращается СТРОИТЕЛЬ запроса, а не
 * его результат: строитель `await`-ится так же, как обещание, поэтому
 * для всех вызывающих ничего не изменилось, — но у него есть `.toSQL()`.
 * Этим пользуется гейт цены (`npm run cost`): он меряет НАСТОЯЩИЙ запрос
 * панели, а не его копию. Копия рассохлась бы в первый же день, и гейт
 * стерёг бы запрос, которого в продукте нет.
 */
export function listConversationsFor(tx: Executor, participantId: string, workspaceId: string) {
  /**
   * Закреплён ли разговор ЭТИМ человеком (task-038).
   *
   * ⚠️ ПОДЗАПРОСОМ, А НЕ СОЕДИНЕНИЕМ. Соединение с таблицей закреплений
   * размножило бы строки, если закрепление когда-нибудь перестанет быть
   * одним на пару, — а список каналов обязан оставаться списком каналов.
   * Цена та же: индекс `pin_conversation_uq` отдаёт одну строку.
   */
  const pinned = sql<boolean>`EXISTS (
    SELECT 1 FROM ${pin}
    WHERE ${pin.conversationId} = ${THIS_CONVERSATION}
      AND ${pin.participantId} = ${participantId}
  )`;

  /**
   * Когда в разговоре в последний раз говорили.
   *
   * ⚠️ БЕРЁТСЯ ПО НАИБОЛЬШЕМУ НОМЕРУ, А НЕ ЧЕРЕЗ `MAX(created_at)`,
   * И ЭТО НЕ ПРИДИРКА, А ЗАМЕРЕННЫЕ 147 РАЗ (Д-30). Индекса
   * `(conversation_id, created_at)` нет и заводить его незачем: `seq`
   * монотонен внутри пространства (`nextSeq` под блокировкой строки
   * пространства), поэтому «самая свежая реплика» и «реплика
   * с наибольшим номером» — одно и то же. По номеру уже есть индекс
   * `message_conversation_seq_desc_idx`, и он отдаёт ОДНУ строку.
   *
   * Замер на канале в 50 023 реплики:
   *   MAX(created_at)          — 50 023 строки, 1572 буфера, 14,2 мс
   *   ORDER BY seq DESC LIMIT 1 —      1 строка,    5 буферов, 0,096 мс
   *
   * Панель перечитывается на каждый звонок потока у каждого клиента,
   * то есть на каждое сообщение в пространстве. Разница множится
   * на число каналов и на число открытых вкладок.
   *
   * ⚠️ УДАЛЁННЫЕ РЕПЛИКИ СЧИТАЮТСЯ ЗА АКТИВНОСТЬ — так было и раньше,
   * и менять это здесь нельзя: `MAX(created_at)` их тоже видел. Тихо
   * изменить смысл заодно с ускорением — верный способ получить
   * поломку, которую никто не свяжет с этой правкой.
   */
  const lastAt = sql<Date>`GREATEST(
    ${conversation.createdAt},
    COALESCE((
      SELECT ${message.createdAt} FROM ${message}
      WHERE ${message.conversationId} = ${THIS_CONVERSATION}
      ORDER BY ${message.seq} DESC
      LIMIT 1
    ), ${conversation.createdAt})
  )`;

  return (
    tx
      .select({
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.title,
        parentId: conversation.parentId,
        lastAt,
        projectId: conversation.projectId,
        unread: unreadOf(THIS_CONVERSATION, participantId),
        mentions: mentionsOf(THIS_CONVERSATION, participantId),
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
        SELECT ${conversationRead.readSeq} FROM ${conversationRead}
        WHERE ${conversationRead.conversationId} = ${THIS_CONVERSATION}
          AND ${conversationRead.participantId} = ${participantId}
      ), 0)`,
        pinned: pinned,
      })
      .from(conversation)
      /**
       * ⚠️ СВОЁ ПРОСТРАНСТВО — ОТДЕЛЬНЫМ УСЛОВИЕМ, хотя видимость и так
       * его отсекает. Видимость — проверка на строку, а не отбор: без этого
       * условия запрос обходил разговоры ВСЕХ пространств базы и проверял
       * каждый (на стенде — пятнадцать тысяч строк на один показ панели).
       * Условие по пространству берёт индекс `conversation_workspace_alive_idx`.
       */
      .where(
        and(
          eq(conversation.workspaceId, workspaceId),
          isNull(conversation.deletedAt),
          visibleTo(participantId),
        ),
      )
      /**
       * ⚠️ ЗАКРЕПЛЁННОЕ ПОДНИМАЕТ СЕРВЕР, А НЕ КЛИЕНТ (task-038). Порядок
       * в панели — одно знание; посчитай его ещё и клиент, они однажды
       * разойдутся, и у человека закреплённое будет прыгать при каждом
       * обновлении списка. Это же правило записано в самой панели:
       * «переупорядочивать здесь нельзя».
       */
      .orderBy(desc(pinned), desc(lastAt))
  );
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
 * Начало любого запроса за ВИДОМ сообщения: поля и все связки разом.
 *
 * ⚠️ ОДНО МЕСТО, ПОТОМУ ЧТО ЭТО ОДНО ЗНАНИЕ — «из чего собирается
 * реплика на экране»: автор, цитата с её автором, источник пересылки
 * с его автором. Цепочка стояла пятью копиями подряд, и гейт повторов
 * поймал шестую в тот же день, когда она появилась. Разъехавшись,
 * копии дали бы ленту, где у пересланного сообщения есть автор
 * источника, а у закреплённого — нет.
 *
 * Условия и порядок дописывает вызывающий: они у всех разные, и это
 * как раз то, что отличает эти запросы друг от друга.
 */
function selectMessages(tx: Executor) {
  return tx
    .select({ ...MESSAGE_VIEW, updatedSeq: message.updatedSeq })
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId));
}

/**
 * Вид одного сообщения по идентификатору.
 *
 * Нужен там, где сообщение уже записано или уже существовало: строить вид,
 * выбирая «последние N» и разыскивая среди них нужное, — ошибка, из-за
 * которой у повтора терялся автор (найдено 2026-09-06).
 */
export async function findMessageViewById(tx: Executor, messageId: string) {
  const rows = await selectMessages(tx).where(eq(message.id, messageId)).limit(1);
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
   * из него лишние номера значит платить за то, что никому не нужно.
   * Группу с одним номером догон отдаёт целиком, даже на границе
   * страницы (`sync` в `service.ts`) — без этого её хвост терялся.
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
  return selectMessages(tx)
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
  const rows = await selectMessages(tx)
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
 * Лента НЕСКОЛЬКИХ разговоров разом, свежее первым.
 *
 * ⚠️ ОДИН ЗАПРОС НА ВСЮ ОБЛАСТЬ, А НЕ ПО ЗАПРОСУ НА ЧАТ (Д-31). Агент,
 * зовомый с областью «весь проект» (Р-032), читает десяток чатов сразу;
 * вызов `listMessages` по каждому давал три запроса на чат — проверку
 * видимости, ленту и голову пространства, — то есть шестьдесят запросов
 * на один ответ.
 *
 * ⚠️ ВИДИМОСТЬ ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ, И ЭТО НЕ ДЫРА. Список разговоров
 * приходит из `readingScope`, который считает пересечение «чаты проекта
 * ∩ видимые позвавшему» ОДНИМ запросом. Проверять во второй раз здесь
 * значило бы иметь два ответа на вопрос о правах; правило проекта прямо
 * требует обратного. Функция закрыта пакетом: снаружи `talk` её нет.
 *
 * Предел общий на всю область: бюджет приглашения модели считается
 * по знакам и делится между чатами, а не умножается на их число.
 */
export async function listMessagesIn(tx: Executor, conversationIds: string[], limit: number) {
  if (conversationIds.length === 0) return [];
  const rows = await selectMessages(tx)
    .where(and(inArray(message.conversationId, conversationIds), isNull(message.deletedAt)))
    .orderBy(desc(message.seq))
    .limit(limit);
  return rows.reverse();
}

/**
 * Догон: всё, что изменилось в пространстве после номера, — только
 * в разговорах, которые человек видит (`visibleTo`).
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
    selectMessages(tx)
      // Догону нужен ещё и сам разговор: по нему проверяется видимость.
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
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
