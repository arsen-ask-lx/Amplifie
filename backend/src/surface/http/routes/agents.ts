import type { FastifyInstance } from "fastify";
import { agentsFor } from "../../../app/agents.js";
import { resolveActor } from "../../../kernel/identity/index.js";
import { SESSION_COOKIE } from "./auth.js";

/**
 * Раздел «Агенты»: кто есть в пространстве и через чей мост они отвечают.
 *
 * ⚠️ ТОЛЬКО ЧТЕНИЕ. Агент заводится при первом ответе (`ensureAgent`),
 * а не при взгляде на список. `GET`, который пишет, однажды заведёт
 * участника от чужого запроса, и журнал получит событие без причины.
 */
export function registerAgentRoutes(app: FastifyInstance): void {
  app.get("/v1/agents", async (request, reply) => {
    const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
    if (!actor) return reply.code(401).send({ error: "not_authenticated" });

    return agentsFor({
      participantId: actor.participantId,
      workspaceId: actor.workspaceId,
    });
  });
}
