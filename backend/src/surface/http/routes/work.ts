import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ModelUnavailableError } from "../../../app/answering.js";
import { listenTo } from "../../../app/listen.js";
import { BreakerOpenError, NotAgentTaskError, runTask } from "../../../app/working.js";
import { resolveActor } from "../../../kernel/identity/index.js";
import { ConversationNotVisibleError } from "../../../kernel/talk/index.js";
import {
  AgreementNotVisibleError,
  createTask,
  decide,
  listAgreements,
  listParticipants,
  listTasks,
  NotHumanError,
  patchTask,
  STAGES,
  TaskNotVisibleError,
} from "../../../kernel/work/index.js";
import { BridgeFailedError, BridgeSilentError } from "../../../platform/rendezvous.js";
import { SESSION_COOKIE } from "./auth.js";
import { parse } from "./parse.js";

/** Ядро продукта наружу: разбор разговора, договорённости, задачи. */

async function actorOf(request: FastifyRequest, reply: FastifyReply) {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return actor;
}

const newTaskSchema = z.object({
  title: z.string().trim().min(1, "у задачи нужно название").max(200),
  responsibleId: z.uuid("нужен ответственный — и это человек"),
  assignedToId: z.uuid().nullable().optional(),
});

const patchTaskSchema = z
  .object({
    // Список стадий закрыт и здесь, и в базе. Два рубежа на одно правило —
    // осознанно: витрина обязана ответить человеку 422, а не пятисоткой,
    // но настоящий сторож всё равно в базе.
    stage: z.enum(STAGES).optional(),
    assignedToId: z.uuid().nullable().optional(),
    responsibleId: z.uuid().optional(),
  })
  .refine((one) => Object.keys(one).length > 0, "нечего менять");

/**
 * Отказы доски → коды причин.
 *
 * `NotHumanError` — 422, а не 403: это не «нельзя», а «не тот вид
 * участника». Человек чинит выбором из списка, а не правами.
 */
async function orTaskFailure(
  reply: FastifyReply,
  work: () => Promise<FastifyReply>,
): Promise<FastifyReply> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotHumanError) {
      return reply.code(422).send({ error: "not_human", detail: error.message });
    }
    if (error instanceof TaskNotVisibleError) {
      return reply.code(404).send({ error: "not_found" });
    }
    throw error;
  }
}

/**
 * Отказ прогона → код причины.
 *
 * `409` у размыкателя, а не `503`: это не «сломалось», а «дальше нужен
 * человек». Разные починки — разные коды.
 */
function runFailure(error: unknown): { code: number; body: object } | null {
  if (error instanceof BreakerOpenError) {
    return { code: 409, body: { error: "breaker_open", detail: error.message } };
  }
  if (error instanceof NotAgentTaskError) {
    return { code: 422, body: { error: "not_agent_task", detail: error.message } };
  }
  if (error instanceof TaskNotVisibleError) {
    return { code: 404, body: { error: "not_found" } };
  }
  if (error instanceof ModelUnavailableError) {
    return { code: 503, body: { error: "model_unavailable" } };
  }
  if (error instanceof BridgeSilentError) {
    return { code: 504, body: { error: "model_silent" } };
  }
  if (error instanceof BridgeFailedError) {
    return { code: 502, body: { error: "model_failed", detail: error.message } };
  }
  return null;
}

export function registerWorkRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>("/v1/conversations/:id/listen", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;

    try {
      const added = await listenTo(
        { participantId: actor.participantId, workspaceId: actor.workspaceId },
        request.params.id,
      );
      return reply.code(200).send({ proposed: added });
    } catch (error) {
      if (error instanceof ConversationNotVisibleError) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw error;
    }
  });

  app.get("/v1/agreements", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;
    return { items: await listAgreements(actor.workspaceId) };
  });

  app.get("/v1/tasks", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;
    return { items: await listTasks(actor.workspaceId) };
  });

  /** Участники пространства: кого можно назначить исполнителем. */
  app.get("/v1/participants", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;
    return { items: await listParticipants(actor.workspaceId) };
  });

  /** Завести задачу руками — без договорённости (task-010). */
  app.post("/v1/tasks", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;

    const input = parse(newTaskSchema, request.body, reply);
    if (!input) return reply;

    return orTaskFailure(reply, async () => reply.code(201).send(await createTask(actor, input)));
  });

  /**
   * Пусть агент сделает задачу (task-011).
   *
   * ⚠️ Запускает ЧЕЛОВЕК и платит своей настройкой. Агент себя не
   * запускает: иначе доска стала бы счётчиком расходов, который никто
   * не заводил.
   */
  app.post<{ Params: { id: string } }>("/v1/tasks/:id/run", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;

    try {
      return reply.send(await runTask(actor, request.params.id));
    } catch (error) {
      const known = runFailure(error);
      if (!known) throw error;
      return reply.code(known.code).send(known.body);
    }
  });

  /** Подвинуть по доске, назначить исполнителя, сменить ответственного. */
  app.patch<{ Params: { id: string } }>("/v1/tasks/:id", async (request, reply) => {
    const actor = await actorOf(request, reply);
    if (!actor) return reply;

    const input = parse(patchTaskSchema, request.body, reply);
    if (!input) return reply;

    return orTaskFailure(reply, async () =>
      reply.send(await patchTask(actor, request.params.id, input)),
    );
  });

  for (const verdict of ["confirm", "reject"] as const) {
    app.post<{ Params: { id: string } }>(
      `/v1/agreements/:id/${verdict}`,
      async (request, reply) => {
        const actor = await actorOf(request, reply);
        if (!actor) return reply;

        try {
          return await decide(
            {
              workspaceId: actor.workspaceId,
              participantId: actor.participantId,
              kind: actor.kind,
            },
            request.params.id,
            verdict,
          );
        } catch (error) {
          // Нет такой, чужая, или решает не человек — снаружи одно и то же.
          if (error instanceof AgreementNotVisibleError) {
            return reply.code(404).send({ error: "not_found" });
          }
          throw error;
        }
      },
    );
  }
}
