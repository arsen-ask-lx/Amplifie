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
import { alias, type SelectedFields } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";
import {
  conversation,
  conversationMember,
  conversationRead,
  message,
  messageSearch,
  pin,
} from "./schema.js";
import { mentionsOf, unreadOf } from "./unread.js";

/** Хранилище модуля talk: только запросы. Непрочитанное — в `unread.ts`, отдаётся отсюда. */
export { countUnread, markRead } from "./unread.js";

/** Курсор панели — последнее место в серверном порядке, не номер строки. */
export interface PanelCursor {
  pinned: boolean;
  lastAt: Date;
  id: string;
}

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
 * Единственное правило видимости (Р-010). Всё читается у корня — видимость,
 * пространство, удалённость, членство: у ветки своих прав нет (task-027 №1).
 * «Что видит человек» (`visibleTo`) и «кто видит разговор» (`mentions.ts`)
 * зовут эту функцию, чтобы у прав был один ответ.
 *
 * Псевдонимы `root` и `asker`: правило вставляется в запросы, где
 * `conversation` и `participant` уже заняты внешней строкой.
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

/**
 * Единственное правило «человек убирает здесь чужое» (Р-035): владелец
 * пространства или владелец канала-корня. Им отвечает и проверка удаления,
 * и признак в панели — один ответ о правах.
 */
function moderates(
  conversationId: SQLWrapper,
  parentId: SQLWrapper,
  participantId: SQLWrapper | string,
): SQL<boolean> {
  return sql<boolean>`(
    EXISTS (
      SELECT 1 FROM ${participant} AS boss
      WHERE boss.id = ${participantId} AND boss.role = 'owner'
    )
    OR EXISTS (
      SELECT 1 FROM ${conversationMember} AS keeper
      WHERE keeper.conversation_id = COALESCE(${parentId}, ${conversationId})
        AND keeper.participant_id = ${participantId}
        AND keeper.role = 'owner'
    )
  )`;
}

/** Убирает ли человек чужое в этом разговоре. */
export async function canModerate(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ yes: moderates(conversation.id, conversation.parentId, participantId) })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .limit(1);
  return rows[0]?.yes === true;
}

/** Разговоры (строки `conversation` запроса), видимые этому человеку. */
export function visibleTo(participantId: string): SQL {
  return canSee(conversation.id, conversation.parentId, participantId);
}

/**
 * Разговор, видимый участнику, одним запросом. Не найден и не виден — оба
 * `null`: иначе по ответу перебирали бы существующие разговоры.
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

/**
 * Завести членство.
 *
 * ⚠️ СМЕНА ЧЛЕНСТВА ОБЯЗАНА СБРАСЫВАТЬ ХВОСТ ИЗМЕНЕНИЙ
 * (`platform/tail.ts`, task-084). Адресаты лежат там снимком на момент
 * записи реплики. Добавь человека в закрытый канал без сброса —
 * и у него с открытой вкладкой база отдала бы реплики по видимости
 * «сейчас», а хвост их отфильтрует и сдвинет курсор вперёд: реплики
 * исчезнут навсегда и молча.
 *
 * Сегодня выполняется по построению: членство заводится только
 * при создании разговора, а оно идёт через `change()`, который зовёт
 * `forget`. Новый вызов отсюда обязан это сохранить.
 */
export async function insertMember(
  tx: Executor,
  input: { conversationId: string; participantId: string; workspaceId: string; role?: string },
) {
  await tx.insert(conversationMember).values(input);
}

/**
 * Внешний разговор из связанного подзапроса — с именем таблицы. В списке
 * полей drizzle печатает `${conversation.id}` как голое `"id"`, и внутри
 * `FROM "message"` оно молча значит `message.id`: подзапрос возвращает
 * пусто без ошибки (так было, task-024).
 */
const THIS_CONVERSATION = sql.raw('"conversation"."id"');

/**
 * Панель: разговоры по свежести (Р-011), закреплённое — первым; разговор
 * без реплик держится временем создания. Со строками едут счётчики.
 *
 * Не `async`: отдаётся строитель запроса — он так же `await`-ится, но у него
 * есть `.toSQL()`, и гейт цены меряет настоящий запрос, а не копию.
 */
export function listConversationsFor(
  tx: Executor,
  participantId: string,
  workspaceId: string,
  options: {
    projectId?: string;
    /** Только чаты без папки — «Недавние» (Р-033). */
    loose?: boolean;
    /** Одна строка по имени — её просит лента открытого чата. */
    onlyId?: string;
    rootOnly?: boolean;
    limit?: number;
    after?: PanelCursor;
  } = {},
) {
  // Подзапросом, а не соединением: список разговоров не должен размножаться.
  const pinned = sql<boolean>`EXISTS (
    SELECT 1 FROM ${pin}
    WHERE ${pin.conversationId} = ${THIS_CONVERSATION}
      AND ${pin.participantId} = ${participantId}
  )`;

  /**
   * Последняя активность — по наибольшему номеру, а не `MAX(created_at)`
   * (Д-30): `seq` монотонен в пространстве, и индекс
   * `message_conversation_seq_idx` отдаёт одну строку вместо обхода канала.
   * Удалённые реплики считаются активностью.
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

  const after = options.after
    ? sql`(
        ${pinned} < ${options.after.pinned}
        OR (
          ${pinned} = ${options.after.pinned}
          AND (
            ${lastAt} < ${options.after.lastAt}
            OR (${lastAt} = ${options.after.lastAt} AND ${conversation.id} < ${options.after.id})
          )
        )
      )`
    : undefined;

  const query = tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      parentId: conversation.parentId,
      lastAt,
      projectId: conversation.projectId,
      unread: unreadOf(THIS_CONVERSATION, participantId),
      mentions: mentionsOf(THIS_CONVERSATION, participantId),
      // Докуда дочитал: счётчик отвечает «сколько», черта в ленте — «откуда»
      // (как `read_inbox_max_id` у Телеграма). Нет отметки — ноль.
      readSeq: sql<number>`COALESCE((
        SELECT ${conversationRead.readSeq} FROM ${conversationRead}
        WHERE ${conversationRead.conversationId} = ${THIS_CONVERSATION}
          AND ${conversationRead.participantId} = ${participantId}
      ), 0)`,
      pinned: pinned,
      // Убирает ли здесь чужое (Р-035) — фронт по нему показывает «Удалить».
      moderator: moderates(conversation.id, conversation.parentId, participantId),
    })
    .from(conversation)
    // Пространство — отдельным условием, хотя видимость его отсекает:
    // видимость проверяет строку, а не отбирает, и без условия запрос
    // обходил разговоры всех пространств базы.
    .where(
      and(
        eq(conversation.workspaceId, workspaceId),
        isNull(conversation.deletedAt),
        visibleTo(participantId),
        // Старый снимок панели ещё отдаёт ветки: его потребляют лента и
        // догон. Постраничная навигация проекта — только корневые чаты.
        options.rootOnly ? isNull(conversation.parentId) : undefined,
        options.projectId === undefined ? undefined : eq(conversation.projectId, options.projectId),
        options.loose ? isNull(conversation.projectId) : undefined,
        options.onlyId === undefined ? undefined : eq(conversation.id, options.onlyId),
        after,
      ),
    )
    /**
     * Порядок панели считает сервер. Клиент его не пересортировывает,
     * но с task-092 двигает СВОЮ строку на один известный шаг по применённой
     * реплике — и только доказав её непрерывность номером. Разрыв — берёт
     * панель отсюда заново. Разбор: Р-037, правка 16.09.2026.
     */
    .orderBy(desc(pinned), desc(lastAt), desc(conversation.id));

  return options.limit === undefined ? query : query.limit(options.limit);
}

/**
 * Непрочитанное и упоминания по каждому проекту — одним запросом.
 *
 * ⚠️ СЧЁТ ИДЁТ ПО ВИДИМЫМ ЧАТАМ, И ЭТО НЕ МЕЛОЧЬ. Сложи он все, число
 * у папки рассказывало бы о приватном чате, которого человек не видит,
 * — счётчик стал бы боковым каналом (Р-010).
 */
export function projectCountsFor(tx: Executor, participantId: string, workspaceId: string) {
  return tx
    .select({
      projectId: conversation.projectId,
      unread: sql<number>`COALESCE(SUM(${unreadOf(THIS_CONVERSATION, participantId)}), 0)::int`,
      mentions: sql<number>`COALESCE(SUM(${mentionsOf(THIS_CONVERSATION, participantId)}), 0)::int`,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.workspaceId, workspaceId),
        isNull(conversation.deletedAt),
        isNotNull(conversation.projectId),
        visibleTo(participantId),
      ),
    )
    .groupBy(conversation.projectId);
}

/** Мягко удалить разговор. «Ещё не удалён» — в самом запросе: повтор ничего не двигает. */
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
  // У новой реплики номер изменения равен её номеру — ставится только здесь.
  const rows = await tx
    .insert(message)
    .values({ ...input, updatedSeq: input.seq })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось записать сообщение");
  return row;
}

/**
 * «Эта реплика изменилась» — единственное место, где берётся номер изменения
 * для правки, удаления и закрепления. Счётчик тот же, что у `seq`: один курсор.
 */
async function changed(tx: Executor, workspaceId: string): Promise<{ updatedSeq: number }> {
  return { updatedSeq: await nextSeq(tx, workspaceId) };
}

/** Цитата и источник пересылки — те же таблицы под псевдонимами. */
const quoted = alias(message, "quoted");
const quotedAuthor = alias(participant, "quoted_author");
const source = alias(message, "source");
const sourceAuthor = alias(participant, "source_author");

/**
 * Единственный список полей сообщения. Цитата — ссылкой, текст читается
 * присоединением (копия разошлась бы с правкой); присоединение левое —
 * цитаты может не быть.
 */
const MESSAGE_VIEW = {
  id: message.id,
  // Связывает черновик на экране с записанной репликой: без него клиент
  // пересоздаёт строку и теряет выделение и анимацию.
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
  // Удаление мягкое: ссылка остаётся, тело пустое — признак нужен явно.
  replyToDeletedAt: quoted.deletedAt,
  replyToAuthorName: quotedAuthor.displayName,
  forwardedFromAuthorName: sourceAuthor.displayName,
} as const;

/**
 * Начало любого запроса за видом сообщения: поля и все связки — одно знание
 * «из чего собрана реплика». Условия и порядок дописывает вызывающий.
 *
 * `extra` — поля сверх вида, которые нужны одному вызывающему (поиску —
 * название чата). Вид при этом остаётся одним: второй сборки реплики
 * рядом с этой не заводится (task-100).
 */
// biome-ignore lint/complexity/noBannedTypes: пустой набор полей — законное «без добавок»
function selectMessages<Extra extends SelectedFields = {}>(tx: Executor, extra?: Extra) {
  return tx
    .select({ ...MESSAGE_VIEW, updatedSeq: message.updatedSeq, ...(extra ?? ({} as Extra)) })
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId));
}

/** Вид одного сообщения по идентификатору. */
export async function findMessageViewById(tx: Executor, messageId: string) {
  const rows = await selectMessages(tx).where(eq(message.id, messageId)).limit(1);
  return rows[0] ?? null;
}

/** Сама запись сообщения без вида — для проверок «моё ли, тут ли». */
export async function findMessage(tx: Executor, messageId: string) {
  const rows = await tx.select().from(message).where(eq(message.id, messageId)).limit(1);
  return rows[0] ?? null;
}

/** Правка тела. Отметка «изменено» ставится только здесь. */
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
  // Один номер на всё удаление, даже когда оно задевает ответы: счётчик
  // сериализует записи (Д-2). Группу с одним номером догон отдаёт целиком.
  const mark = await changed(tx, workspaceId);

  const rows = await tx
    .update(message)
    // Тело стирается: удалённое не читается ни из базы, ни из выгрузки.
    .set({ deletedAt: new Date(), body: "", ...mark })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id, conversationId: message.conversationId });

  if (!rows[0]) return null;

  // Ответы на удалённое тоже изменились (Д-20): их цитата собирается
  // присоединением, и для догона «изменилось» — это «человек увидит другое».
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
 * Лента: последние N по возрастанию номера. `before` — курсор по значению
 * (строго старше), а не смещение: смещение съезжает от новых сообщений.
 */
export async function listMessages(
  tx: Executor,
  conversationId: string,
  limit: number,
  before?: number,
) {
  const rows = await selectMessages(tx)
    // Удалённых в ленте нет; догон отдаёт их надгробием.
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
 * Лента вперёд: первые N строго новее номера, по возрастанию (task-099).
 * Тот же индекс `(conversation_id, seq)`, что у страницы назад, — прямым ходом.
 *
 * Не `async`: отдаётся строитель запроса, и гейт цены меряет его `.toSQL()`.
 */
export function listMessagesNewer(
  tx: Executor,
  conversationId: string,
  limit: number,
  after: number,
) {
  return selectMessages(tx)
    .where(
      and(
        eq(message.conversationId, conversationId),
        isNull(message.deletedAt),
        gt(message.seq, after),
      ),
    )
    .orderBy(asc(message.seq))
    .limit(limit);
}

/**
 * Страница поиска по сообщениям (task-100): новые сверху, одна строка сверх
 * предела — «есть ли ещё». Слова уже собраны в `query` (`search.ts`).
 *
 * Не `async`: отдаётся строитель запроса, и гейт цены меряет его `.toSQL()`.
 *
 * ⚠️ ПОРЯДОК И КУРСОР — ПО НОМЕРУ ТАБЛИЦЫ ПОИСКА, А НЕ РЕПЛИКИ. Значение то же,
 * но индекс `(workspace_id, seq)` лежит на ней: сортировка по номеру реплики
 * лишила бы планировщик обхода «новые сверху» для частого слова. Какой путь
 * выбрать — обход или выборку из индекса слов — решает планировщик по
 * статистике слов (точность 1000, миграция 0027; замер шага 0 — 22 мс худший
 * случай на миллионе реплик).
 *
 * ⚠️ ПРАВА — ТЕ ЖЕ, ЧТО У ЛЕНТЫ (`visibleTo`), и в момент поиска: в таблице
 * поиска прав нет.
 */
export function searchMessagesPage(
  tx: Executor,
  viewer: { participantId: string; workspaceId: string },
  query: SQL,
  limit: number,
  before?: number,
  conversationId?: string,
) {
  return selectMessages(tx, { conversationTitle: conversation.title })
    .innerJoin(messageSearch, eq(messageSearch.messageId, message.id))
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(messageSearch.workspaceId, viewer.workspaceId),
        sql`${messageSearch.doc} @@ (${query})`,
        isNull(message.deletedAt),
        isNull(conversation.deletedAt),
        visibleTo(viewer.participantId),
        before === undefined ? undefined : lt(messageSearch.seq, before),
        /**
         * Поиск в одном чате (task-106). Фильтр стоит по таблице ПОИСКА,
         * а не по сообщению: индекс `(conversation_id, seq)` лежит на ней,
         * и без него частое слово в маленьком чате читало 11 704 буфера
         * вместо 24 (замер 18.09 на 200 тыс. реплик).
         */
        conversationId === undefined ? undefined : eq(messageSearch.conversationId, conversationId),
      ),
    )
    .orderBy(desc(messageSearch.seq))
    .limit(limit + 1);
}

/**
 * Сколько всего попаданий в одном чате — для счётчика «3 из 17» (task-106).
 *
 * ⚠️ С ПОТОЛКОМ, А НЕ ЦЕЛИКОМ. Считать все попадания частого слова — это
 * прочитать их все: на замере подсчёт с потолком 1000 стоил 447 буферов,
 * без потолка он растёт вместе с чатом. Выше потолка счётчик говорит «1000+».
 */
export async function countMatchesIn(
  tx: Executor,
  viewer: { participantId: string; workspaceId: string },
  query: SQL,
  conversationId: string,
  cap: number,
): Promise<number> {
  const capped = tx
    .select({ one: sql`1` })
    .from(messageSearch)
    .innerJoin(message, eq(message.id, messageSearch.messageId))
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(messageSearch.workspaceId, viewer.workspaceId),
        eq(messageSearch.conversationId, conversationId),
        sql`${messageSearch.doc} @@ (${query})`,
        isNull(message.deletedAt),
        isNull(conversation.deletedAt),
        visibleTo(viewer.participantId),
      ),
    )
    .limit(cap);
  const rows = await tx.select({ total: sql<number>`count(*)::int` }).from(capped.as("found"));
  return rows[0]?.total ?? 0;
}

/**
 * Лента нескольких разговоров одним запросом (Д-31) — для области агента
 * «весь проект» (Р-032). Видимость здесь не проверяется: список уже отобран
 * `scopeFeed` по правам позвавшего; снаружи `talk` функции нет.
 * Предел общий на всю область, а не на чат.
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
 * Догон: изменившееся в пространстве после номера, только в видимых
 * разговорах. Сверху ограничен `upToSeq` — той границей, что получит клиент:
 * иначе записанное между двумя чтениями терялось бы навсегда.
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
          // По номеру изменения, а не сказанного: правка не двигает `seq`.
          gt(message.updatedSeq, afterSeq),
          lte(message.updatedSeq, upToSeq),
          // Удалённые не отсекаются: приезжают надгробием (`presentMessage`).
          visibleTo(participantId),
        ),
      )
      // Место в ленте клиент берёт из `seq`, а не из порядка ответа.
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

/**
 * Кому виден разговор: `null` — всем в пространстве, иначе участники корня.
 *
 * Нужен звонку с адресом (task-067): адрес закрытого разговора уходит только
 * тем, кто его видит. Один запрос на изменение, а не на слушателя, — в этом
 * весь выигрыш.
 *
 * ⚠️ ВИДИМОСТЬ ЧИТАЕТСЯ У КОРНЯ. У ветки своих участников нет (Р-010),
 * поэтому и видимость, и членство берутся у `coalesce(parent_id, id)`.
 * Иначе ветка закрытого канала звонила бы всему пространству.
 */
export async function audienceOf(tx: Executor, conversationId: string): Promise<string[] | null> {
  const root = alias(conversation, "root");
  const rows = await tx
    .select({ visibility: root.visibility, participantId: conversationMember.participantId })
    .from(conversation)
    .innerJoin(root, eq(root.id, sql`coalesce(${conversation.parentId}, ${conversation.id})`))
    .leftJoin(conversationMember, eq(conversationMember.conversationId, root.id))
    .where(eq(conversation.id, conversationId));

  const first = rows[0];
  // Разговора нет — звонить некому. Это не ошибка: он мог быть только что снесён.
  if (!first) return [];
  if (first.visibility === "workspace") return null;
  return rows.map((one) => one.participantId).filter((one): one is string => one !== null);
}
