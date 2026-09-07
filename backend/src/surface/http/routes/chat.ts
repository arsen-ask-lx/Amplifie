import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  answerIfAddressed,
  ModelUnavailableError,
  NotAddressedError,
} from "../../../app/answering.js";
import { resolveActor } from "../../../kernel/identity/index.js";
import {
  ConversationNotVisibleError,
  createChannel,
  createThread,
  listConversations,
  listMessages,
  sendMessage,
  sync,
  type Viewer,
} from "../../../kernel/talk/index.js";
import { BridgeFailedError, BridgeSilentError } from "../../../platform/rendezvous.js";
import { SESSION_COOKIE } from "./auth.js";
import { parse } from "./parse.js";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

const sendSchema = z.object({
  body: z.string().trim().min(1, "сообщение пустое").max(8000, "сообщение длиннее 8000 символов"),
  clientMsgId: z.uuid("нужен идентификатор, сгенерированный клиентом"),
});

const channelSchema = z.object({
  title: z.string().trim().min(1, "у канала нужно название").max(120),
  // Приватный канал в интерфейсе пока не заводится, но чтение его уже
  // проверено тестом: поле не мёртвое, а опережающее (Р-010).
  visibility: z.enum(["workspace", "private"]).optional(),
});

const threadSchema = z.object({
  title: z.string().trim().min(1, "у ветки нужно название").max(200),
});

/** Кто пришёл. Без сессии дальше не пускаем. */
async function viewerOf(request: FastifyRequest, reply: FastifyReply): Promise<Viewer | null> {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return { participantId: actor.participantId, workspaceId: actor.workspaceId };
}

function clampLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE;
  return Math.min(Math.trunc(value), MAX_PAGE);
}

/**
 * Разговора нет ЛИБО он тебе не виден — снаружи одно и то же, 404.
 * 403 сказал бы «такой разговор существует», и по нему можно перебирать.
 *
 * Обёртка, а не try/catch в каждом обработчике: одно знание — одно место.
 */
/**
 * Отказ модели → код причины. Ни один из них НЕ рождает сообщения в ленте:
 * реплика «извините, ошибка» от имени участника — это ложь про то, кто
 * говорил. Такому место в журнале, а не в разговоре.
 */
function modelFailure(error: unknown): { code: number; body: object } | null {
  if (error instanceof ModelUnavailableError) {
    return { code: 503, body: { error: "model_unavailable" } };
  }
  if (error instanceof BridgeSilentError) {
    return { code: 504, body: { error: "model_silent", detail: error.message } };
  }
  if (error instanceof BridgeFailedError) {
    return { code: 502, body: { error: "model_failed", detail: error.message } };
  }
  return null;
}

/**
 * Позвать агента и превратить исход в ответ витрины.
 *
 * Вынесено из маршрута отдельной функцией не ради красоты: у маршрута
 * получалось три ветки поверх двух обёрток, и линтер сложности был прав —
 * такое читается только целиком.
 */
async function answerOrExplain(
  reply: FastifyReply,
  viewer: { participantId: string; workspaceId: string },
  conversationId: string,
): Promise<FastifyReply> {
  try {
    return reply.code(201).send(await answerIfAddressed(viewer, conversationId));
  } catch (error) {
    // Обращения не было — это не ошибка, а обычный ход событий: клиент
    // зовёт после каждой отправки и не обязан сам разбирать текст.
    if (error instanceof NotAddressedError) return reply.code(204).send();
    const known = modelFailure(error);
    if (known) return reply.code(known.code).send(known.body);
    throw error;
  }
}

async function orNotFound<T>(
  reply: FastifyReply,
  work: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConversationNotVisibleError) {
      return reply.code(404).send({ error: "not_found" });
    }
    throw error;
  }
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.get("/v1/conversations", async (request, reply) => {
    const viewer = await viewerOf(request, reply);
    if (!viewer) return reply;
    return { items: await listConversations(viewer) };
  });

  app.post("/v1/conversations", async (request, reply) => {
    const viewer = await viewerOf(request, reply);
    if (!viewer) return reply;

    const input = parse(channelSchema, request.body, reply);
    if (!input) return reply;

    const created = await createChannel(viewer, input);
    return reply.code(201).send({
      id: created.id,
      kind: created.kind,
      title: created.title,
      parentId: created.parentId,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/v1/conversations/:id/messages",
    async (request, reply) => {
      const viewer = await viewerOf(request, reply);
      if (!viewer) return reply;
      // before — курсор листания назад. Мусор в нём означает «с конца»,
      // а не ошибку: сломанная ссылка не должна ронять экран.
      const before = Number(request.query.before);
      return orNotFound(reply, async () =>
        listMessages(
          viewer,
          request.params.id,
          clampLimit(request.query.limit),
          Number.isFinite(before) && before > 0 ? before : undefined,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>("/v1/conversations/:id/messages", async (request, reply) => {
    const viewer = await viewerOf(request, reply);
    if (!viewer) return reply;

    const input = parse(sendSchema, request.body, reply);
    if (!input) return reply;

    return orNotFound(reply, async () => {
      const result = await sendMessage(viewer, request.params.id, input);
      // 200 на повтор, 201 на новое: клиент по коду понимает, что произошло,
      // а повтор после разрыва — нормальная работа, а не ошибка.
      return reply.code(result.replayed ? 200 : 201).send(result.message);
    });
  });

  app.post<{ Params: { id: string } }>("/v1/conversations/:id/threads", async (request, reply) => {
    const viewer = await viewerOf(request, reply);
    if (!viewer) return reply;

    const input = parse(threadSchema, request.body, reply);
    if (!input) return reply;

    return orNotFound(reply, async () =>
      reply.code(201).send(await createThread(viewer, request.params.id, input.title)),
    );
  });

  /**
   * Позвать агента разобрать разговор.
   *
   * ОТДЕЛЬНАЯ ДВЕРЬ, А НЕ ЧАСТЬ ОТПРАВКИ. Сообщение обязано записаться
   * мгновенно и не зависеть от модели: упавшая модель не должна означать
   * потерянную реплику. Поэтому клиент сперва отправляет, а потом зовёт.
   *
   * ⚠️ ЗОВЁТ КЛИЕНТ — значит закрытая вкладка равна отсутствию ответа.
   * Признано и записано в очередь работ. Лечится очередью, а её у нас нет
   * и заводить ради одного случая рано (task-006 §3).
   */
  app.post<{ Params: { id: string } }>("/v1/conversations/:id/ask", async (request, reply) => {
    const viewer = await viewerOf(request, reply);
    if (!viewer) return reply;

    return orNotFound(reply, () => answerOrExplain(reply, viewer, request.params.id));
  });

  /**
   * Единственная дверь догона. И живое обновление, и восстановление после
   * разрыва идут одним кодом — Matrix пришёл к этому после болезненной
   * переделки, а не сразу.
   */
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    "/v1/sync",
    async (request, reply) => {
      const viewer = await viewerOf(request, reply);
      if (!viewer) return reply;

      const after = Number(request.query.after ?? 0);
      return sync(
        viewer,
        Number.isFinite(after) && after > 0 ? after : 0,
        clampLimit(request.query.limit),
      );
    },
  );
}
