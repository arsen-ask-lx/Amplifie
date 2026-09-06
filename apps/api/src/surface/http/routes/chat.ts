import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveActor } from "../../../kernel/identity/index.js";
import {
  ConversationNotVisibleError,
  createThread,
  listConversations,
  listMessages,
  sendMessage,
  sync,
  type Viewer,
} from "../../../kernel/talk/index.js";
import { SESSION_COOKIE } from "./auth.js";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

const sendSchema = z.object({
  body: z.string().trim().min(1, "сообщение пустое").max(8000, "сообщение длиннее 8000 символов"),
  clientMsgId: z.uuid("нужен идентификатор, сгенерированный клиентом"),
});

const threadSchema = z.object({
  title: z.string().trim().min(1, "у ветки нужно название").max(200),
});

/** Разбор на границе: 422 — прочитал, но поля не годятся. */
function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  reply.code(422).send({ error: "validation_failed", fields });
  return null;
}

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
