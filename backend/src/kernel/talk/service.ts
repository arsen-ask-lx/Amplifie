import type { Message, SyncLine } from "@amplifie/contract/api";
import { publish } from "../../platform/bus.js";
import { change } from "../../platform/change.js";
import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import { setMentions, зовущиеся } from "./mentions.js";
import { listProjectsFor, требуетсяПроект } from "./projects.js";
import * as repo from "./repo.js";

/**
 * Вид реплики и надгробия — формы из общего контракта (Р-034), а не свои
 * копии. Надгробие без текста: удалённое не отдаётся никому, включая тех,
 * кто уже видел его на экране (как redaction у Matrix).
 */
type MessageView = Message;

/**
 * Сколько текста цитаты уезжает в ленту.
 *
 * Цитата — это напоминание, а не второе сообщение. Длинная превращает
 * ленту в удвоенную саму себя; у Телеграма примерно столько же.
 */
const EXCERPT = 120;

function excerptOf(body: string): string {
  // Переводы строк схлопываются: цитата живёт в одну строку, и настоящий
  // перенос в ней сломал бы высоту пузыря сильнее, чем помог бы смыслу.
  const flat = body.replace(/\s+/gu, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat;
}

/**
 * Строка догона: живая реплика или надгробие.
 *
 * Развилка ровно одна и стоит здесь — до того, как собран вид. Собрать
 * вид и потом «вычистить поля» значило бы держать текст удалённой реплики
 * в руках и рассчитывать не забыть его выбросить.
 */
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
    /**
     * На что это ответ. `null` — ответа не было ЛИБО исходную реплику
     * удалили: снаружи это одно и то же намеренно.
     *
     * ⚠️ УДАЛЁННОСТЬ ПРОВЕРЯЕТСЯ ОТМЕТКОЙ, А НЕ ПУСТЫМ ТЕЛОМ. Мягкое
     * удаление стирает тело в пустую строку, а не в `null`, — и цитата
     * на удалённое показывала рамку с пустым текстом вместо того,
     * чтобы исчезнуть. Нашёл приёмочный тест, который до этого молча
     * падал на другой причине.
     */
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
 * Панель целиком: разговоры и проекты ОДНИМ ответом.
 *
 * ⚠️ ОДНИМ, А НЕ ДВУМЯ ЗАПРОСАМИ. Панель перечитывается на каждый звонок
 * потока (Р-006), и второй запрос за проектами удваивал бы самый частый
 * обмен в продукте. Внутри — тоже один проход по проектам, а не по чату
 * на проект: N+1 здесь не виден, пока проектов три.
 */
export async function listConversations(viewer: Viewer) {
  const [rows, projects] = await Promise.all([
    repo.listConversationsFor(db, viewer.participantId),
    listProjectsFor(db, viewer.participantId, viewer.workspaceId),
  ]);
  return {
    projects,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      parentId: r.parentId,
      // К какому проекту относится разговор. `null` — вне проектов (Р-032).
      projectId: r.projectId,
      // Время последней активности отдаём наружу: по нему клиент показывает
      // «когда тут в последний раз говорили», не запрашивая ленту.
      lastAt: new Date(r.lastAt).toISOString(),
      // Сколько чужих реплик человек ещё не видел (Р-029). Едет вместе
      // со списком, а не отдельной дверью: панель каналов и так его
      // перечитывает, и второй запрос был бы ровно тем же обходом.
      unread: r.unread,
      // Сколько раз в разговоре позвали именно этого человека и он этого
      // ещё не видел (Р-031). Отдельное число, а не часть непрочитанного:
      // у Телеграма рядом с `unread_count` по той же причине живёт
      // `unread_mentions_count`.
      mentions: r.mentions,
      readSeq: Number(r.readSeq),
      // Закреплён ли ЭТИМ человеком (task-038). Личное: у коллеги своё.
      pinned: r.pinned,
    })),
  };
}

/**
 * Отметить разговор прочитанным до номера включительно.
 *
 * ⚠️ ПРАВО — ЭТО ВИДИМОСТЬ РАЗГОВОРА, А НЕ ЧЛЕНСТВО В НЁМ. Сперва
 * проверкой служил пустой результат `UPDATE` по строке участника —
 * и это оказалось неверно: канал открыт всему пространству, читатель
 * может не быть его участником, и отметка глохла 404-й у всех, кто вошёл
 * позже заведения канала. Кто разговор ВИДИТ, тот вправе отметить его
 * прочитанным: прочтение — это про его собственный взгляд, а не про
 * права в разговоре.
 *
 * Возвращает пересчитанный остаток: клиент видит только загруженный
 * кусок ленты и посчитать сам не может. Так же поступает Телеграм,
 * присылая `still_unread_count` рядом с номером.
 */
export async function markRead(viewer: Viewer, conversationId: string, seq: number) {
  await requireVisible(db, viewer, conversationId);
  /**
   * ⚠️ НЕ ДАЛЬШЕ ГОЛОВЫ ПРОСТРАНСТВА. Номер идёт только вперёд (GREATEST),
   * и отметка «из будущего» — ошибка клиента или подмена — навсегда
   * пометила бы прочитанными ещё не написанные сообщения (task-027 №5).
   */
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
  /**
   * ⚠️ ГОЛОВА ПРОСТРАНСТВА ОТДАЁТСЯ ВМЕСТЕ СО СТРАНИЦЕЙ, И ЭТО НЕ
   * НАГРУЗКА, А ЕЁ СНЯТИЕ.
   *
   * Свежая вкладка нигде не была, и догонять ей нечего: догон отвечает
   * на вопрос «что изменилось, пока меня не было». Без этого числа
   * клиент брал начальный курсор из последней страницы ОТКРЫТОГО
   * разговора — и, открыв тихий канал, оказывался далеко позади головы.
   * Дальше он переигрывал историю страницами по пятьдесят: до тысячи
   * чужих сообщений на каждую перезагрузку страницы. Замерено
   * в браузере (Д-19).
   *
   * Один дешёвый запрос по первичному ключу против двадцати страниц
   * догона — обмен, который не требует размышлений.
   */
  const head = await repo.currentSeq(db, viewer.workspaceId);
  return { items: rows.map(presentMessage), hasMore: rows.length === limit, head };
}

/**
 * Записать сообщение: номер, вставка, событие, готовый вид.
 *
 * Общее для человека и агента. Разделять их копией нельзя: расходится
 * не текст, а поведение — например, кто-то один перестанет писать событие,
 * и журнал начнёт врать про половину сообщений.
 */
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
  // Номер берётся ТОЛЬКО так и только внутри этой же транзакции.
  // Важно, что это UPDATE строки, а не последовательность: при откате
  // номер возвращается обратно и дыры не остаётся.
  const seq = await repo.nextSeq(tx, target.workspaceId);

  const created = await repo.insertMessage(tx, {
    workspaceId: target.workspaceId,
    seq,
    ...input,
  });

  await setMentions(tx, created.id, await зовущиеся(tx, input.conversationId, input.body));

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
 * Отправка сообщения.
 *
 * Идемпотентность доменная: ключ `clientMsgId` генерирует клиент в момент
 * набора. Повтор — не ошибка, а нормальная работа клиента после разрыва:
 * возвращаем то же самое сообщение и тот же номер.
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

      // ⚠️ ЦИТАТА И ИСТОЧНИК ПЕРЕСЫЛКИ ПРОВЕРЯЮТСЯ ТОЙ ЖЕ ПРОВЕРКОЙ ВИДИМОСТИ.
      // Оба идентификатора приходят от клиента, а цитата ПОКАЗЫВАЕТ ТЕКСТ:
      // без проверки по ним вытаскивался бы кусок чужого разговора. Здесь
      // не «на всякий случай», а единственный рубеж.
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

    // Звонок ТОЛЬКО после фиксации (Р-006). Позвонив раньше, мы отправили бы
    // клиента в /v1/sync за тем, чего в базе ещё нет, — и второго звонка
    // бы не было. Повтор не звонит: ничего не изменилось.
    if (!result.replayed) publish(viewer.workspaceId);
    return result;
  } catch (error) {
    // Гонка: два запроса с одним ключом ушли одновременно и оба прошли
    // проверку «уже есть». Проигравший откатывается — номер возвращается
    // счётчику, дыры не остаётся, — и получает то же сообщение.
    // Без этой ветки двойной клик давал бы пятисотку.
    if (!isDuplicateClientMsgId(error)) throw error;

    const existing = await repo.findMessageByClientId(db, conversationId, input.clientMsgId);
    if (!existing) throw error;
    return { replayed: true, message: await viewOf(db, existing.id) };
  }
}

/**
 * Сообщение от имени участника-агента.
 *
 * ПОЧЕМУ ДВА УЧАСТНИКА В ПОДПИСИ. Видимость проверяется по ЧЕЛОВЕКУ, который
 * позвал: агент сегодня не состоит в каналах, он участник пространства.
 * Автором же ставится агент — иначе журнал не ответит на вопрос «кто это
 * сказал», а в ленте появится реплика человека, которую он не писал.
 * Когда агент станет членом канала, первый параметр уйдёт.
 *
 * `kind = "agent"` — чтобы следующий разбор не принял слова агента за
 * человеческие и не вышла петля. `trust = "untrusted"` — текст пришёл
 * от модели, то есть это недоверенный ввод, ровно как ответ моста.
 */
export async function sendAsAgent(
  onBehalfOf: Viewer,
  agentParticipantId: string,
  conversationId: string,
  input: { body: string; clientMsgId: string },
): Promise<MessageView> {
  const result = await withTransaction(async (tx) => {
    const target = await requireVisible(tx, onBehalfOf, conversationId);

    // Идемпотентность: ключ выводится из сообщения-обращения, поэтому
    // двойной зов даёт один ответ, а не два.
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
      // Ветка от ветки не заводится: дерево ровно двухуровневое, иначе
      // «корень» перестаёт быть однозначным.
      throw new ConversationNotVisibleError();
    }

    const created = await repo.insertConversation(tx, {
      workspaceId: parent.workspaceId,
      kind: "thread",
      title,
      parentId,
    });

    // ⚠️ Участников ветке НЕ заводим: право наследуется от канала.
    // База это и не позволит — триггер conversation_member_root_only.

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
 * Догон: что появилось после номера, и куда клиенту двигать курсор.
 *
 * Единственное свойство, которое здесь обязано выполняться всегда:
 * **`seq` не смеет обогнать последнее отданное сообщение.** Клиент двигает
 * курсор ровно на него, поэтому всё, что осталось между отданным и `seq`,
 * он не увидит уже никогда. Обе дыры, через которые это происходило:
 *
 * ① граница читалась ОТДЕЛЬНЫМ запросом одновременно с лентой — два разных
 *    снимка базы. Теперь граница читается первой, и лента ограничена ею;
 * ② при обрезке по `limit` отдавалась граница пространства, а не последнее
 *    отданное сообщение. Теперь при обрезке `seq` — последнее отданное.
 *
 * `hasMore` избавляет клиента от угадывания: пришло true — идти за следующей
 * страницей немедленно, а не ждать звонка.
 */
export async function sync(viewer: Viewer, afterSeq: number, limit: number) {
  // Порядок важен. Граница — первой: всё, что зафиксируется после её чтения,
  // просто придёт следующим догоном. Наоборот было бы потерей.
  const bound = await repo.currentSeq(db, viewer.workspaceId);
  const after = (from: number, upTo: number, size: number) =>
    repo.listMessagesAfter(db, viewer.workspaceId, viewer.participantId, from, upTo, size);

  const rows = await after(afterSeq, bound, limit);
  const last = rows.at(-1);
  if (rows.length < limit || !last) {
    return { messages: rows.map(presentLine), seq: bound, hasMore: false };
  }

  /**
   * ⚠️ СТРАНИЦА НАБРАЛАСЬ — ПОСЛЕДНЯЯ ГРУППА ДОЧИТЫВАЕТСЯ ЦЕЛИКОМ.
   * Одно изменение может задеть несколько строк одним номером (удаление
   * реплики двигает и ответы на неё), и `LIMIT` рвёт такую группу. Курсор
   * встаёт на номер группы, а строгое «больше» следующей страницы навсегда
   * пропустило бы её хвост (task-027 №4). Курсор — номер ИЗМЕНЕНИЯ, а не
   * номер реплики: правка старой реплики иначе уводила курсор назад (№3).
   */
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

  // Изменение состояния и событие — в одной транзакции. Без исключений (Р-2):
  // первая же «мелочь без события» превращает журнал в тот, которому нельзя
  // доверять. Эта строка была пропущена и найдена проверкой журнала.
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

/**
 * Завести разговор и сделать заводящего его владельцем.
 *
 * Общее у канала и обсуждения задачи: вставка, членство, событие.
 * Разъехавшись копией, они однажды перестали бы одинаково записывать
 * событие — и половина разговоров пропала бы из журнала.
 */
async function openConversation(
  viewer: Viewer,
  input: { kind: string; title: string; visibility: Visibility; projectId?: string | undefined },
) {
  return change(viewer.workspaceId, async (tx) => {
    // ⚠️ ПРОЕКТ ПРОВЕРЯЕТСЯ ДО ВСТАВКИ И ТОЙ ЖЕ ПРОВЕРКОЙ, ЧТО И ПЕРЕНОС.
    // Иначе по номеру проекта из соседней компании можно было бы завести
    // канал прямо к ним в панель.
    if (input.projectId) await требуетсяПроект(tx, viewer.workspaceId, input.projectId);

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
 * Создать канал.
 *
 * Строку членства заводим создателю ВСЕГДА, даже для открытого канала:
 * членство отвечает не за доступ, а за «канал у меня в списке». Для
 * приватного она же оказывается единственным основанием доступа —
 * и это не совпадение, а ровно то разделение, ради которого писалось Р-010.
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
 * Удалить канал.
 *
 * ⚠️ ТОЛЬКО ТОТ, КТО ЕГО ЗАВЁЛ. Канал виден всему пространству, но
 * «видно» и «можно снести» — разные права, и слить их значило бы отдать
 * любому участнику право стереть чужую переписку. Роль `owner` заводится
 * создателю в тот же миг, что и сам канал (`openConversation`).
 *
 * ⚠️ ЧУЖОЕ И НЕСУЩЕСТВУЮЩЕЕ ОТВЕЧАЮТ ОДИНАКОВО. Отдельный отказ на чужое
 * подтвердил бы, что канал существует, — по нему перебираются чужие
 * пространства. Тот же приём, что у правки реплики.
 *
 * ⚠️ УДАЛЕНИЕ МЯГКОЕ. На сообщения канала ссылаются ответы и пересылки
 * из других каналов; каскад превратил бы их в цитаты в пустоту.
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
      // Название — чтобы по журналу было видно, ЧТО снесли: сама строка
      // ещё лежит в базе, но в списках её больше нет.
      payload: { title: found.title },
    });
  });
}

/**
 * Обсуждение задачи — обычный разговор вида `task`.
 *
 * НЕ НОВАЯ СУЩНОСТЬ. Один слой хранит каналы, ветки и обсуждения задач;
 * лента, догон и живые обновления работают там даром. Отдельная таблица
 * «комментарии к задаче» пришлось бы учить всему этому заново.
 *
 * Разговор не знает, что он чей-то: ссылку держит задача (Р-4, `talk`
 * ничего не знает про работу). Поэтому здесь нет ни слова про `task`,
 * кроме названия.
 */
export async function createTaskDiscussion(viewer: Viewer, title: string): Promise<{ id: string }> {
  const created = await openConversation(viewer, { kind: "task", title, visibility: "workspace" });
  return { id: created.id };
}

/**
 * Сообщение существует, не удалено и лежит в видимом мне разговоре.
 *
 * Возвращает идентификатор или бросает «не найдено». Ничего не отдавать
 * молча нельзя: беззвучно проглоченная ссылка означала бы ответ, который
 * потерял, на что отвечает, — и человек об этом не узнает.
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
  // ⚠️ ОДИН КОД НА «НЕ ТВОЁ» И «НЕТ ТАКОГО», и это не лень. Отдельный ответ
  // на «чужое» подтвердил бы, что сообщение существует, — по нему
  // перебираются чужие разговоры.
  if (found.authorParticipantId !== viewer.participantId) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  return found;
}

/**
 * Событие о реплике в журнал: правка, удаление, закрепление.
 *
 * ⚠️ БЕЗ ТЕКСТА — НИ СТАРОГО, НИ НОВОГО. Журнал живёт дольше сообщения
 * и читается шире разговора. Одна функция на три действия, чтобы это
 * правило не приходилось помнить трижды: три копии нашёл гейт повторов.
 */
async function logMessageEvent(
  tx: Executor,
  viewer: Viewer,
  kind: string,
  messageId: string,
  found: { conversationId: string; seq: bigint | number | string },
): Promise<void> {
  await appendEvent(tx, {
    kind,
    workspaceId: viewer.workspaceId,
    actorParticipantId: viewer.participantId,
    subjectType: "message",
    subjectId: messageId,
    payload: { conversationId: found.conversationId, seq: Number(found.seq) },
  });
}

/**
 * Изменить своё сообщение.
 *
 * Отметку «изменено» ставит хранилище, а не этот код: разнесённая
 * по вызывающим, она однажды не поставится, и лента соврёт.
 */
export async function editMessage(
  viewer: Viewer,
  messageId: string,
  body: string,
): Promise<MessageView> {
  return change(viewer.workspaceId, async (tx) => {
    const found = await requireMine(tx, viewer, messageId);
    const changed = await repo.updateMessageBody(tx, viewer.workspaceId, messageId, body);
    if (!changed) throw new ConversationNotVisibleError();

    // Правка меняет и то, кого зовут: убрал упоминание — значка
    // у человека остаться не должно.
    await setMentions(tx, messageId, await зовущиеся(tx, found.conversationId, body));

    await logMessageEvent(tx, viewer, "message.edited", messageId, found);
    return viewOf(tx, messageId);
  });
}

/**
 * Удалить своё сообщение.
 *
 * ⚠️ МЯГКО. Строка остаётся, тело стирается: на реплику могут ссылаться
 * ответы и пересылки, и жёсткое удаление либо унесло бы их с собой,
 * либо оставило висеть в пустоту.
 */
export async function deleteMessage(viewer: Viewer, messageId: string): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    const found = await requireMine(tx, viewer, messageId);
    const gone = await repo.softDeleteMessage(tx, viewer.workspaceId, messageId);
    if (!gone) throw new ConversationNotVisibleError();

    await logMessageEvent(tx, viewer, "message.deleted", messageId, found);
  });
}

/**
 * Закрепить или открепить.
 *
 * Закрепляет ЛЮБОЙ, кому разговор виден, а не только автор: закреплённое —
 * свойство разговора, а не сообщения его написавшего. Так в Телеграме
 * и в Слаке.
 */
export async function pinMessage(
  viewer: Viewer,
  messageId: string,
  pinned: boolean,
): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    const found = await repo.findMessage(tx, messageId);
    if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
    await requireVisible(tx, viewer, found.conversationId);

    // Повтор — не ошибка: закрепить закреплённое означает «пусть будет
    // закреплено», и результат тот же.
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
