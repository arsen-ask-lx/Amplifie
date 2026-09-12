import type { Message, SyncLine } from "@amplifie/contract/api";
import { publish } from "../../platform/bus.js";
import { change } from "../../platform/change.js";
import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import { mentionedWhoSee, setMentions } from "./mentions.js";
import { listProjectsFor, requireProject, requireVisibleProject } from "./projects.js";
import * as repo from "./repo.js";

function presentConversation(row: Awaited<ReturnType<typeof repo.listConversationsFor>>[number]) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    parentId: row.parentId,
    projectId: row.projectId,
    lastAt: new Date(row.lastAt).toISOString(),
    unread: row.unread,
    mentions: row.mentions,
    readSeq: Number(row.readSeq),
    pinned: row.pinned,
    moderator: row.moderator,
  };
}

/**
 * Вид реплики и надгробия — формы из общего контракта (Р-034), а не свои
 * копии. Надгробие без текста: удалённое не отдаётся никому, включая тех,
 * кто уже видел его на экране (как redaction у Matrix).
 */
type MessageView = Message;

/** Цитата — напоминание, а не второе сообщение: столько же, сколько у Телеграма. */
const EXCERPT = 120;

function excerptOf(body: string): string {
  // Цитата живёт в одну строку — переводы строк схлопываются.
  const flat = body.replace(/\s+/gu, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat;
}

/** Строка догона: живая реплика или надгробие — развилка до сборки вида. */
function presentLine(row: Awaited<ReturnType<typeof repo.listMessagesAfter>>[number]): SyncLine {
  if (row.deletedAt !== null) {
    return { id: row.id, conversationId: row.conversationId, seq: Number(row.seq), deleted: true };
  }
  return presentMessage(row);
}

function presentMessage(row: Awaited<ReturnType<typeof repo.listMessages>>[number]): MessageView {
  return {
    id: row.id,
    clientMsgId: row.clientMsgId,
    conversationId: row.conversationId,
    body: row.body,
    kind: row.kind,
    seq: Number(row.seq),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    author: { id: row.authorId, name: row.authorName, kind: row.authorKind },
    // `null` — ответа не было или цитату удалили. Удалённость — по отметке:
    // мягкое удаление стирает тело в пустую строку, а не в `null`.
    replyTo:
      row.replyToId === null || row.replyToBody === null || row.replyToDeletedAt !== null
        ? null
        : {
            id: row.replyToId,
            seq: Number(row.replyToSeq),
            author: row.replyToAuthorName ?? "",
            excerpt: excerptOf(row.replyToBody),
          },
    forwardedFrom: row.forwardedFromAuthorName,
  };
}

/** Вид сообщения по идентификатору. Одно место, где он собирается. */
async function viewOf(tx: Executor, messageId: string): Promise<MessageView> {
  const row = await repo.findMessageViewById(tx, messageId);
  if (!row) throw new Error(`сообщение ${messageId} записано, но не читается обратно`);
  return presentMessage(row);
}

/** Нарушение UNIQUE(conversation_id, client_msg_id) — тот же ключ пришёл дважды. */
function isDuplicateClientMsgId(error: unknown): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  const code = candidate?.code ?? (candidate?.cause as { code?: unknown } | undefined)?.code;
  const constraint =
    candidate?.constraint ?? (candidate?.cause as { constraint?: unknown } | undefined)?.constraint;
  return code === "23505" && constraint === "message_conversation_client_msg_uq";
}

/**
 * Панель целиком: разговоры и проекты одним ответом — её перечитывают
 * на каждый звонок потока (Р-006), и второй обмен удвоил бы самый частый.
 */
export async function listConversations(viewer: Viewer) {
  const [rows, projects] = await Promise.all([
    repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId),
    listProjectsFor(db, viewer.participantId, viewer.workspaceId),
  ]);
  return {
    projects,
    items: rows.map(presentConversation),
  };
}

/** Порция видимых корневых чатов проекта. Берём одну строку сверх лимита,
 * чтобы назвать наличие продолжения без отдельного COUNT. */
export async function listProjectConversations(
  viewer: Viewer,
  projectId: string,
  after: repo.PanelCursor | undefined,
  limit: number,
) {
  await requireVisibleProject(db, viewer.participantId, viewer.workspaceId, projectId);
  const rows = await repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId, {
    projectId,
    rootOnly: true,
    limit: limit + 1,
    ...(after ? { after } : {}),
  });
  return pageOf(rows, limit);
}

/**
 * Порция строк панели: сами строки и курсор продолжения.
 *
 * ⚠️ ОДНА СТРОКА СВЕРХ ЛИМИТА ВМЕСТО ВТОРОГО ЗАПРОСА. «Есть ли ещё» — это
 * `COUNT(*)` по всему списку, то есть цена вопроса больше цены ответа.
 * Курсор непрозрачен для клиента: в нём порядок сервера — закрепление,
 * последняя активность и имя строки.
 */
function pageOf(
  rows: Awaited<ReturnType<typeof repo.listConversationsFor>>,
  limit: number,
): { items: ReturnType<typeof presentConversation>[]; next: string | null } {
  const page = rows.slice(0, limit);
  const tail = page.at(-1);
  return {
    items: page.map(presentConversation),
    next:
      rows.length > limit && tail
        ? Buffer.from(
            JSON.stringify({
              pinned: tail.pinned,
              lastAt: new Date(tail.lastAt).toISOString(),
              id: tail.id,
            }),
          ).toString("base64url")
        : null,
  };
}

/** Сколько «Недавних» приезжает сразу. Дальше — по прокрутке, курсором. */
const RECENT_PAGE = 25;

/**
 * Следующая порция «Недавних» — чатов без папки (Р-033). Первая приезжает
 * в сводном ответе; эта дверь нужна, когда человек долистал панель до низа.
 */
export async function listRecent(viewer: Viewer, after: repo.PanelCursor | undefined) {
  const rows = await repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId, {
    loose: true,
    rootOnly: true,
    limit: RECENT_PAGE + 1,
    ...(after ? { after } : {}),
  });
  return pageOf(rows, RECENT_PAGE);
}

/**
 * Сводный ответ панели (task-064, Р-037): проекты со счётчиками, первая
 * порция «Недавних» и строка открытого чата.
 *
 * ⚠️ ЧАТОВ ПРОЕКТОВ ЗДЕСЬ НЕТ, И В ЭТОМ ВЕСЬ СМЫСЛ. Прежний ответ вёз все
 * разговоры пространства: замер 11.09 — 1,4 МБ и 5 241 строка на каждое
 * сообщение в любом чате. Чаты проекта приезжают, когда его раскрыли.
 *
 * ⚠️ ОТКРЫТЫЙ ЧАТ ПРИХОДИТ ОТДЕЛЬНОЙ СТРОКОЙ. Он может лежать в свёрнутом
 * проекте, и без него лента не знает ни названия, ни своих прав.
 */
export async function panelSnapshot(viewer: Viewer, openId?: string) {
  const [projects, counts, recentRows, openRows] = await Promise.all([
    listProjectsFor(db, viewer.participantId, viewer.workspaceId),
    repo.projectCountsFor(db, viewer.participantId, viewer.workspaceId),
    repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId, {
      loose: true,
      rootOnly: true,
      limit: RECENT_PAGE + 1,
    }),
    openId
      ? repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId, {
          onlyId: openId,
          limit: 1,
        })
      : Promise.resolve([]),
  ]);

  const byProject = new Map(counts.map((one) => [one.projectId, one]));
  return {
    projects: projects.map((folder) => ({
      ...folder,
      unread: byProject.get(folder.id)?.unread ?? 0,
      mentions: byProject.get(folder.id)?.mentions ?? 0,
    })),
    recent: pageOf(recentRows, RECENT_PAGE),
    // Нет такого чата или он не виден — `null`, а не отказ: панель обязана
    // нарисоваться и по мёртвой ссылке.
    open: openRows[0] ? presentConversation(openRows[0]) : null,
  };
}

/**
 * Отметить прочитанным до номера включительно. Право — видимость, а не
 * членство: прочтение про взгляд, а открытый канал читают и не участники.
 * Отдаёт пересчитанный остаток: клиент видит только окно ленты
 * (как `still_unread_count` у Телеграма).
 */
export async function markRead(viewer: Viewer, conversationId: string, seq: number) {
  await requireVisible(db, viewer, conversationId);
  // Не дальше головы: номер идёт только вперёд, и отметка «из будущего»
  // навсегда пометила бы ненаписанное (task-027 №5).
  const head = await repo.currentSeq(db, viewer.workspaceId);
  await repo.markRead(db, conversationId, viewer.participantId, Math.min(seq, head));
  return { unread: await repo.countUnread(db, conversationId, viewer.participantId) };
}

/**
 * Лента разговора страницами назад.
 *
 * `hasMore` считается по признаку «страница набралась целиком»: просить
 * у базы отдельный COUNT ради этого — лишний запрос на каждое листание.
 * Цена — одна пустая страница в конце, когда сообщений ровно кратно
 * размеру. Дёшево и не врёт.
 */
export async function listMessages(
  viewer: Viewer,
  conversationId: string,
  limit: number,
  before?: number,
) {
  await requireVisible(db, viewer, conversationId);
  const rows = await repo.listMessages(db, conversationId, limit, before);
  // Голова пространства — начальный курсор догона для свежей вкладки;
  // без неё клиент переигрывал историю страницами (Д-19).
  const head = await repo.currentSeq(db, viewer.workspaceId);
  return { items: rows.map(presentMessage), hasMore: rows.length === limit, head };
}

/** Записать сообщение: номер, вставка, упоминания, событие, вид. Общее для человека и агента. */
async function writeMessage(
  tx: Executor,
  target: { workspaceId: string },
  input: {
    conversationId: string;
    authorParticipantId: string;
    body: string;
    clientMsgId: string;
    kind?: string;
    trust?: string;
    replyToId?: string | null;
    forwardedFromId?: string | null;
  },
): Promise<MessageView> {
  // Номер — `UPDATE` строки в этой же транзакции, а не последовательность:
  // при откате он возвращается, и дыры не остаётся.
  const seq = await repo.nextSeq(tx, target.workspaceId);

  const created = await repo.insertMessage(tx, {
    workspaceId: target.workspaceId,
    seq,
    ...input,
  });

  await setMentions(tx, created.id, await mentionedWhoSee(tx, input.conversationId, input.body));

  // Ответил — значит видел всё до ответа (как у Slack и Telegram). Своих
  // непрочитанных тогда не бывает, и счётчику не нужно перебирать свои
  // реплики, чтобы их отбросить (task-039, находка гейта цены).
  await repo.markRead(tx, input.conversationId, input.authorParticipantId, seq);

  // Состояние и событие — в одной транзакции. Всегда (Р-2).
  await appendEvent(tx, {
    kind: "message.sent",
    workspaceId: target.workspaceId,
    actorParticipantId: input.authorParticipantId,
    subjectType: "message",
    subjectId: created.id,
    payload: { conversationId: input.conversationId, seq },
  });

  return viewOf(tx, created.id);
}

export interface SendResult {
  message: MessageView;
  /** true — сообщение уже было: клиент повторил отправку после разрыва. */
  replayed: boolean;
}

/**
 * Отправка. Ключ `clientMsgId` генерирует клиент при наборе; повтор после
 * разрыва — не ошибка: отдаём то же сообщение с тем же номером.
 */
export async function sendMessage(
  viewer: Viewer,
  conversationId: string,
  input: {
    body: string;
    clientMsgId: string;
    replyToId?: string | undefined;
    forwardedFromId?: string | undefined;
  },
): Promise<SendResult> {
  try {
    const result = await withTransaction(async (tx) => {
      const target = await requireVisible(tx, viewer, conversationId);

      const already = await repo.findMessageByClientId(tx, conversationId, input.clientMsgId);
      if (already) return { replayed: true, message: await viewOf(tx, already.id) };

      // Цитата показывает текст, а её номер пришёл от клиента: без проверки
      // видимости по нему вытаскивался бы кусок чужого разговора.
      const replyToId = await visibleMessageId(tx, viewer, input.replyToId);
      const forwardedFromId = await visibleMessageId(tx, viewer, input.forwardedFromId);

      const message = await writeMessage(tx, target, {
        conversationId,
        authorParticipantId: viewer.participantId,
        body: input.body,
        clientMsgId: input.clientMsgId,
        replyToId,
        forwardedFromId,
      });

      return { replayed: false, message };
    });

    // Звонок после фиксации (Р-006); повтор не звонит — ничего не изменилось.
    if (!result.replayed) publish(viewer.workspaceId);
    return result;
  } catch (error) {
    // Гонка двух запросов с одним ключом: проигравший откатывается
    // и получает то же сообщение, а не 500.
    if (!isDuplicateClientMsgId(error)) throw error;

    const existing = await repo.findMessageByClientId(db, conversationId, input.clientMsgId);
    if (!existing) throw error;
    return { replayed: true, message: await viewOf(db, existing.id) };
  }
}

/**
 * Сообщение от агента. Видимость проверяется по позвавшему человеку
 * (агент не состоит в каналах), автор — агент. `kind = "agent"` не даёт
 * агенту отвечать самому себе; `trust = "untrusted"` — текст от модели.
 */
export async function sendAsAgent(
  onBehalfOf: Viewer,
  agentParticipantId: string,
  conversationId: string,
  input: { body: string; clientMsgId: string },
): Promise<MessageView> {
  const result = await withTransaction(async (tx) => {
    const target = await requireVisible(tx, onBehalfOf, conversationId);

    // Ключ выведен из обращения: двойной зов — один ответ.
    const already = await repo.findMessageByClientId(tx, conversationId, input.clientMsgId);
    if (already) return { fresh: false, message: await viewOf(tx, already.id) };

    const message = await writeMessage(tx, target, {
      conversationId,
      authorParticipantId: agentParticipantId,
      body: input.body,
      clientMsgId: input.clientMsgId,
      kind: "agent",
      trust: "untrusted",
    });

    return { fresh: true, message };
  });

  // Звонок только после фиксации (Р-006), и только если что-то изменилось.
  if (result.fresh) publish(onBehalfOf.workspaceId);
  return result.message;
}

export async function createThread(viewer: Viewer, parentId: string, title: string) {
  return change(viewer.workspaceId, async (tx) => {
    const parent = await requireVisible(tx, viewer, parentId);
    if (parent.parentId) {
      // Дерево двухуровневое: иначе «корень» неоднозначен.
      throw new ConversationNotVisibleError();
    }

    const created = await repo.insertConversation(tx, {
      workspaceId: parent.workspaceId,
      kind: "thread",
      title,
      parentId,
    });

    // Участников у ветки нет — право от корня (триггер conversation_member_root_only).

    await appendEvent(tx, {
      kind: "thread.created",
      workspaceId: parent.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "conversation",
      subjectId: created.id,
      payload: { parentId, title },
    });

    return { id: created.id, kind: created.kind, title: created.title, parentId };
  });
}

/**
 * Догон: что изменилось после номера и куда двигать курсор. Главное
 * свойство: `seq` не обгоняет последнее отданное — клиент ставит курсор
 * на него, и всё между ними потерял бы навсегда. `hasMore` — идти
 * за следующей страницей сразу, не дожидаясь звонка.
 */
export async function sync(viewer: Viewer, afterSeq: number, limit: number) {
  // Граница — первой: записанное после неё придёт следующим догоном.
  const bound = await repo.currentSeq(db, viewer.workspaceId);
  const after = (from: number, upTo: number, size: number) =>
    repo.listMessagesAfter(db, viewer.workspaceId, viewer.participantId, from, upTo, size);

  const rows = await after(afterSeq, bound, limit);
  const last = rows.at(-1);
  if (rows.length < limit || !last) {
    return { messages: rows.map(presentLine), seq: bound, hasMore: false };
  }

  // Страница набралась — последняя группа дочитывается целиком: одно
  // изменение задевает несколько строк одним номером, и `LIMIT` рвёт его
  // хвост (task-027 №4). Курсор — номер изменения, не реплики (№3).
  const lastChange = Number(last.updatedSeq);
  const group = await after(lastChange - 1, lastChange, GROUP_LIMIT);
  const before = rows.filter((one) => Number(one.updatedSeq) < lastChange);
  return {
    messages: [...before, ...group].map(presentLine),
    seq: lastChange,
    hasMore: true,
  };
}

/**
 * Сколько строк бывает у одного изменения. Группа — это реплика и ответы
 * на неё; предел — страховка от бесконечности, а не бюджет.
 */
const GROUP_LIMIT = 10_000;

/**
 * Первый канал пространства. Заводится при регистрации, а не миграцией:
 * миграция не знает идентификатор пространства.
 */
export async function createDefaultChannel(
  tx: Executor,
  input: { workspaceId: string; participantId: string; title: string },
) {
  const channel = await repo.insertConversation(tx, {
    workspaceId: input.workspaceId,
    kind: "channel",
    title: input.title,
  });
  await repo.insertMember(tx, {
    conversationId: channel.id,
    participantId: input.participantId,
    workspaceId: input.workspaceId,
    role: "owner",
  });

  // Состояние и событие — в одной транзакции, без исключений (Р-2).
  await appendEvent(tx, {
    kind: "conversation.created",
    workspaceId: input.workspaceId,
    actorParticipantId: input.participantId,
    subjectType: "conversation",
    subjectId: channel.id,
    payload: { kind: "channel", title: channel.title },
  });

  return channel;
}

/** Кому виден новый канал (Р-010). Ветка своей видимости не имеет. */
export type Visibility = "workspace" | "private";

/** Завести разговор с заводящим-владельцем: общее у канала и обсуждения задачи. */
async function openConversation(
  viewer: Viewer,
  input: { kind: string; title: string; visibility: Visibility; projectId?: string | undefined },
) {
  return change(viewer.workspaceId, async (tx) => {
    // Проект — той же проверкой, что при переносе: иначе по чужому номеру
    // канал заводился бы в панель соседней компании.
    if (input.projectId) await requireProject(tx, viewer.workspaceId, input.projectId);

    const made = await repo.insertConversation(tx, {
      workspaceId: viewer.workspaceId,
      kind: input.kind,
      title: input.title,
      visibility: input.visibility,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    await repo.insertMember(tx, {
      conversationId: made.id,
      participantId: viewer.participantId,
      workspaceId: viewer.workspaceId,
      role: "owner",
    });

    await appendEvent(tx, {
      kind: "conversation.created",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "conversation",
      subjectId: made.id,
      payload: { kind: input.kind, title: made.title, visibility: made.visibility },
    });

    return made;
  });
}

/**
 * Создать канал. Членство создателю — всегда: для открытого это роль
 * владельца, для закрытого — ещё и основание доступа (Р-010).
 */
export async function createChannel(
  viewer: Viewer,
  input: { title: string; visibility?: Visibility | undefined; projectId?: string | undefined },
) {
  return openConversation(viewer, {
    kind: "channel",
    title: input.title,
    visibility: input.visibility ?? "workspace",
    projectId: input.projectId,
  });
}

/**
 * Удалить канал — только владельцу: «видно» и «можно снести» — разные права.
 * Чужое и несуществующее отвечают одинаково, чтобы не выдать существование.
 * Удаление мягкое.
 */
export async function deleteConversation(viewer: Viewer, conversationId: string): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    const found = await repo.findVisibleConversation(tx, conversationId, viewer.participantId);
    if (!found) throw new ConversationNotVisibleError();

    // Ветка не удаляется отдельно: она живёт и умирает вместе с корнем.
    if (found.parentId !== null) throw new ConversationNotVisibleError();

    const role = await repo.roleIn(tx, conversationId, viewer.participantId);
    if (role !== "owner") throw new ConversationNotVisibleError();

    const gone = await repo.softDeleteConversation(tx, conversationId);
    if (!gone) throw new ConversationNotVisibleError();

    await appendEvent(tx, {
      kind: "conversation.deleted",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "conversation",
      subjectId: conversationId,
      // Название — чтобы по журналу было видно, что снесли.
      payload: { title: found.title },
    });
  });
}

/**
 * Сообщение живо и в видимом мне разговоре — иначе «не найдено», а не молчаливый
 * `null`: проглоченная ссылка дала бы ответ, потерявший, на что он отвечает.
 */
async function visibleMessageId(
  tx: Executor,
  viewer: Viewer,
  messageId: string | undefined,
): Promise<string | null> {
  if (!messageId) return null;
  const found = await repo.findMessage(tx, messageId);
  if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  return found.id;
}

/** Сообщение не моё, не существует или удалено — снаружи всё это «нет». */
async function requireMine(tx: Executor, viewer: Viewer, messageId: string) {
  const found = await repo.findMessage(tx, messageId);
  if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
  // «Не твоё» и «нет такого» — один ответ: иначе выдаём, что оно существует.
  if (found.authorParticipantId !== viewer.participantId) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  return found;
}

/**
 * Удалить можно своё — и чужое, если человек здесь модерирует (Р-035).
 * Для остальных чужое — «нет такого», как и прежде.
 */
async function requireDeletable(tx: Executor, viewer: Viewer, messageId: string) {
  const found = await repo.findMessage(tx, messageId);
  if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  if (found.authorParticipantId === viewer.participantId) return { found, moderated: false };
  if (await repo.canModerate(tx, found.conversationId, viewer.participantId)) {
    return { found, moderated: true };
  }
  throw new ConversationNotVisibleError();
}

/**
 * Событие о реплике в журнал — без текста: журнал живёт дольше сообщения
 * и читается шире разговора.
 */
async function logMessageEvent(
  tx: Executor,
  viewer: Viewer,
  kind: string,
  messageId: string,
  found: { conversationId: string; seq: bigint | number | string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  await appendEvent(tx, {
    kind,
    workspaceId: viewer.workspaceId,
    actorParticipantId: viewer.participantId,
    subjectType: "message",
    subjectId: messageId,
    payload: { conversationId: found.conversationId, seq: Number(found.seq), ...extra },
  });
}

/** Изменить своё сообщение. Отметку «изменено» ставит хранилище. */
export async function editMessage(
  viewer: Viewer,
  messageId: string,
  body: string,
): Promise<MessageView> {
  return change(viewer.workspaceId, async (tx) => {
    const found = await requireMine(tx, viewer, messageId);
    const changed = await repo.updateMessageBody(tx, viewer.workspaceId, messageId, body);
    if (!changed) throw new ConversationNotVisibleError();

    // Убрал упоминание — значок у человека гаснет.
    await setMentions(tx, messageId, await mentionedWhoSee(tx, found.conversationId, body));

    await logMessageEvent(tx, viewer, "message.edited", messageId, found);
    return viewOf(tx, messageId);
  });
}

/** Удалить своё сообщение — мягко: на него ссылаются ответы и пересылки. */
export async function deleteMessage(viewer: Viewer, messageId: string): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    const { found, moderated } = await requireDeletable(tx, viewer, messageId);
    const gone = await repo.softDeleteMessage(tx, viewer.workspaceId, messageId);
    if (!gone) throw new ConversationNotVisibleError();

    // Актор — удаливший; признак говорит, что сообщение было чужим (Р-035).
    await logMessageEvent(
      tx,
      viewer,
      "message.deleted",
      messageId,
      found,
      moderated ? { moderated } : {},
    );
  });
}

/** Закрепить или открепить — любому, кому виден разговор, как в Телеграме и Слаке. */
export async function pinMessage(
  viewer: Viewer,
  messageId: string,
  pinned: boolean,
): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    const found = await repo.findMessage(tx, messageId);
    if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
    await requireVisible(tx, viewer, found.conversationId);

    // Повтор — не ошибка: результат тот же.
    await repo.setPinned(tx, viewer.workspaceId, messageId, pinned ? new Date() : null);

    await logMessageEvent(
      tx,
      viewer,
      pinned ? "message.pinned" : "message.unpinned",
      messageId,
      found,
    );
  });
}

/** Закреплённое разговора, свежее сверху. */
export async function listPinned(viewer: Viewer, conversationId: string) {
  await requireVisible(db, viewer, conversationId);
  const rows = await repo.listPinned(db, conversationId);
  return { items: rows.map(presentMessage) };
}
