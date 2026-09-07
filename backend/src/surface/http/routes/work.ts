import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { listenTo } from "../../../app/listen.js";
import { resolveActor } from "../../../kernel/identity/index.js";
import { ConversationNotVisibleError } from "../../../kernel/talk/index.js";
import {
  AgreementNotVisibleError,
  decide,
  listAgreements,
  listTasks,
} from "../../../kernel/work/index.js";
import { SESSION_COOKIE } from "./auth.js";

/** Ядро продукта наружу: разбор разговора, договорённости, задачи. */

async function actorOf(request: FastifyRequest, reply: FastifyReply) {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return actor;
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
