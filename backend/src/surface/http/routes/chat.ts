import {
  askBody,
  channelBody,
  conversationsPage,
  createdConversation,
  createdThread,
  cursorQuery,
  editBody,
  idOnly,
  idParams,
  mentionAt,
  messagesPage,
  messageView,
  moveBody,
  movedConversation,
  openQuery,
  pageQuery,
  panelSnapshot as panelSnapshotView,
  panelView,
  peopleList,
  pinnedList,
  projectBody,
  projectPatchBody,
  readBody,
  readResult,
  searchBody,
  searchPage,
  sendBody,
  syncQuery,
  syncView,
  threadBody,
} from "@amplifie/contract/api";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { answerIfAddressed, NotAddressedError } from "../../../app/answering.js";
import {
  createChannel,
  createProject,
  createThread,
  deleteConversation,
  deleteMessage,
  editMessage,
  listConversations,
  listMessages,
  listPinned,
  listProjectConversations,
  listRecent,
  markRead,
  panelSnapshot,
  peopleToMention,
  pinMessage,
  removeProject,
  renameProject,
  searchMessages,
  sendMessage,
  setConversationPin,
  setProject,
  setProjectPin,
  sync,
  type Viewer,
  whereMentioned,
} from "../../../kernel/talk/index.js";
import { READ, SEARCH, SEND, SYNC } from "../limits.js";
import { actorOf } from "./viewer.js";

/**
 * Двери чата. Форма входа и выхода каждой — схема из общего контракта
 * (Р-034): сервер проверяет по ней запрос и режет ответ, фронт берёт из неё
 * типы. Вход проверяет область дверей, отказы переводит `failures.ts`.
 */

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;
/** Страница поиска: столько строк помещается в окне поиска без прокрутки. */
const DEFAULT_SEARCH_PAGE = 20;

/** Размер страницы из адреса: мусор — значение по умолчанию, не ошибка. */
function pageSize(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE;
  return Math.min(Math.trunc(value), MAX_PAGE);
}

/** Номер из адреса: мусор — ноль, «с начала», а не ошибка. */
function seqOf(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Мусорный курсор не открывает другой срез: начинаем страницу заново. */
function panelCursor(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      pinned?: unknown;
      lastAt?: unknown;
      id?: unknown;
    };
    const lastAt = new Date(typeof parsed.lastAt === "string" ? parsed.lastAt : "");
    if (
      typeof parsed.pinned !== "boolean" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(+lastAt)
    ) {
      return undefined;
    }
    return { pinned: parsed.pinned, lastAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

/**
 * Закрепить: `POST` ставит, `DELETE` снимает — у реплики (для всех
 * в разговоре), у разговора и проекта (в СВОЕЙ панели, task-038).
 * Одна форма двери на три закрепления; повтор безобиден.
 */
const PIN_DOORS: ReadonlyArray<
  [string, (viewer: Viewer, id: string, pinned: boolean) => Promise<void>]
> = [
  ["/v1/messages/:id/pin", pinMessage],
  ["/v1/conversations/:id/pin", setConversationPin],
  ["/v1/projects/:id/pin", setProjectPin],
];

export function registerChatRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.get("/v1/conversations", { schema: { response: { 200: panelView } } }, (request) =>
    listConversations(actorOf(request)),
  );

  /**
   * Сводный ответ панели. `open` — чат, открытый в этой вкладке: его строка
   * нужна ленте, а лежать он может в свёрнутом проекте (task-064).
   */
  app.get(
    "/v1/panel",
    { schema: { querystring: openQuery, response: { 200: panelSnapshotView } } },
    (request) => panelSnapshot(actorOf(request), request.query.open),
  );

  /** Следующая порция «Недавних»: первая приезжает в сводном ответе. */
  app.get(
    "/v1/conversations/recent",
    { schema: { querystring: cursorQuery, response: { 200: conversationsPage } } },
    (request) => listRecent(actorOf(request), panelCursor(request.query.cursor)),
  );

  app.get(
    "/v1/projects/:id/conversations",
    {
      schema: { params: idParams, querystring: cursorQuery, response: { 200: conversationsPage } },
    },
    (request) =>
      listProjectConversations(
        actorOf(request),
        request.params.id,
        panelCursor(request.query.cursor),
        request.query.cursor ? 25 : 10,
      ),
  );

  app.post(
    "/v1/conversations",
    { schema: { body: channelBody, response: { 201: createdConversation } } },
    async (request, reply) =>
      reply.code(201).send(await createChannel(actorOf(request), request.body)),
  );

  /**
   * Отнести чат к проекту либо снять принадлежность. PATCH: это правка
   * свойства разговора, как название, а не отдельное действие над ним.
   */
  app.patch(
    "/v1/conversations/:id",
    { schema: { params: idParams, body: moveBody, response: { 200: movedConversation } } },
    (request) => setProject(actorOf(request), request.params.id, request.body.projectId),
  );

  /** Удалить канал. Чужое и несуществующее — оба 404: см. ядро. */
  app.delete("/v1/conversations/:id", { schema: { params: idParams } }, async (request, reply) => {
    await deleteConversation(actorOf(request), request.params.id);
    return reply.code(204).send();
  });

  /**
   * Отметить прочитанным ДО номера включительно — как `messages.readHistory`
   * у Телеграма. Ответ несёт остаток: клиент видит только окно ленты.
   */
  app.post(
    "/v1/conversations/:id/read",
    {
      config: { rateLimit: READ },
      schema: { params: idParams, body: readBody, response: { 200: readResult } },
    },
    (request) => markRead(actorOf(request), request.params.id, request.body.seq),
  );

  /**
   * Кого можно позвать в ЭТОМ разговоре (Р-031): в приватном — только тех,
   * кто его видит. Общий список пространства предлагал бы действие,
   * которое сервер обязан отклонить.
   */
  app.get(
    "/v1/conversations/:id/people",
    { schema: { params: idParams, response: { 200: peopleList } } },
    async (request) => ({ items: await peopleToMention(actorOf(request), request.params.id) }),
  );

  /** Самый ранний неувиденный зов: клиент держит только окно ленты. */
  app.get(
    "/v1/conversations/:id/mention",
    { schema: { params: idParams, response: { 200: mentionAt } } },
    (request) => whereMentioned(actorOf(request), request.params.id),
  );

  app.get(
    "/v1/conversations/:id/messages",
    { schema: { params: idParams, querystring: pageQuery, response: { 200: messagesPage } } },
    (request) => {
      const before = seqOf(request.query.before);
      // Вперёд — от любого номера, и от нуля тоже: «после нуля» — вся лента с начала.
      const after = request.query.after === undefined ? undefined : seqOf(request.query.after);
      return listMessages(actorOf(request), request.params.id, pageSize(request.query.limit), {
        ...(before > 0 ? { before } : {}),
        ...(after === undefined ? {} : { after }),
      });
    },
  );

  app.post(
    "/v1/conversations/:id/messages",
    {
      config: { rateLimit: SEND },
      schema: {
        params: idParams,
        body: sendBody,
        response: { 200: messageView, 201: messageView },
      },
    },
    async (request, reply) => {
      const result = await sendMessage(actorOf(request), request.params.id, request.body);
      // 200 на повтор, 201 на новое: повтор после разрыва — нормальная работа.
      return reply.code(result.replayed ? 200 : 201).send(result.message);
    },
  );

  app.post(
    "/v1/conversations/:id/threads",
    { schema: { params: idParams, body: threadBody, response: { 201: createdThread } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createThread(actorOf(request), request.params.id, request.body.title)),
  );

  /**
   * Позвать агента разобрать разговор — отдельной дверью, после отправки:
   * упавшая модель не должна означать потерянную реплику. 204 — обращения
   * не было; это обычный ход, а не ошибка.
   */
  app.post(
    "/v1/conversations/:id/ask",
    { schema: { params: idParams, body: askBody.optional() } },
    async (request, reply) => {
      try {
        const answer = await answerIfAddressed(
          actorOf(request),
          request.params.id,
          request.body?.scope ?? "conversation",
        );
        return reply.code(201).send(answer);
      } catch (error) {
        if (error instanceof NotAddressedError) return reply.code(204).send();
        throw error;
      }
    },
  );

  /** Закреплённое разговора: полоска нужна с первого кадра, лента — страницами. */
  app.get(
    "/v1/conversations/:id/pinned",
    { schema: { params: idParams, response: { 200: pinnedList } } },
    (request) => listPinned(actorOf(request), request.params.id),
  );

  /** Правка своей реплики. Чужое отвечает 404: рубеж «только своё» — в ядре. */
  app.patch(
    "/v1/messages/:id",
    { schema: { params: idParams, body: editBody, response: { 200: messageView } } },
    (request) => editMessage(actorOf(request), request.params.id, request.body.body),
  );

  app.delete("/v1/messages/:id", { schema: { params: idParams } }, async (request, reply) => {
    await deleteMessage(actorOf(request), request.params.id);
    return reply.code(204).send();
  });

  for (const [path, pin] of PIN_DOORS) {
    app.post(path, { schema: { params: idParams } }, async (request, reply) => {
      await pin(actorOf(request), request.params.id, true);
      return reply.code(204).send();
    });
    app.delete(path, { schema: { params: idParams } }, async (request, reply) => {
      await pin(actorOf(request), request.params.id, false);
      return reply.code(204).send();
    });
  }

  /** Завести проект (Р-032). Прав проект не несёт — заводит любой участник. */
  app.post(
    "/v1/projects",
    { schema: { body: projectBody, response: { 201: idOnly } } },
    async (request, reply) => {
      const { title, icon, color } = request.body;
      const created = await createProject(actorOf(request), {
        title,
        icon: icon ?? undefined,
        color: color ?? undefined,
      });
      return reply.code(201).send(created);
    },
  );

  /** Поправить папку: имя и/или вид. */
  app.patch(
    "/v1/projects/:id",
    { schema: { params: idParams, body: projectPatchBody, response: { 200: idOnly } } },
    (request) => renameProject(actorOf(request), request.params.id, request.body),
  );

  /** Убрать проект: папка исчезает, переписка остаётся (Р-032). */
  app.delete("/v1/projects/:id", { schema: { params: idParams } }, async (request, reply) => {
    await removeProject(actorOf(request), request.params.id);
    return reply.code(204).send();
  });

  /**
   * Поиск по сообщениям (task-100). `POST`, а не `GET`: текст поиска —
   * переписка людей, и в адресе он попал бы в журналы.
   *
   * ⚠️ ОДНА ДВЕРЬ НА ОБА ПОИСКА (task-106). `conversationId` в теле — поиск
   * внутри чата со счётчиком «3 из 17»; без него — по всем видимым чатам,
   * как окно Ctrl+K. Второй дверью права и слова пришлось бы проверять дважды.
   */
  app.post(
    "/v1/search/messages",
    {
      config: { rateLimit: SEARCH },
      schema: { body: searchBody, response: { 200: searchPage } },
    },
    (request) =>
      searchMessages(
        actorOf(request),
        request.body.q,
        request.body.limit ?? DEFAULT_SEARCH_PAGE,
        request.body.before,
        request.body.conversationId,
      ),
  );

  /**
   * Единственная дверь догона: и живое обновление, и восстановление после
   * разрыва идут одним кодом (Р-006).
   */
  app.get(
    "/v1/sync",
    {
      config: { rateLimit: SYNC },
      schema: { querystring: syncQuery, response: { 200: syncView } },
    },
    (request) => sync(actorOf(request), seqOf(request.query.after), pageSize(request.query.limit)),
  );
}
