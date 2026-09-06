import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueInvite, resolveActor, revokeInvite } from "../../../kernel/identity/index.js";
import { SESSION_COOKIE } from "./auth.js";

/**
 * Приглашения (Р-009).
 *
 * Сырой токен уходит в ответе ОДИН РАЗ и больше не восстановим: в базе
 * лежит только его хеш. Поэтому список приглашений показать можно,
 * а повторно показать ссылку — нельзя, и это не недоделка.
 */

const HOUR_MS = 60 * 60 * 1000;

const issueSchema = z.object({
  // Оба поля — для проверок и для будущей настройки срока в интерфейсе.
  expiresInHours: z.number().positive().max(720).optional(),
  expiresInSeconds: z
    .number()
    .positive()
    .max(720 * 3600)
    .optional(),
});

async function ownerOf(request: FastifyRequest, reply: FastifyReply) {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return actor;
}

export function registerInviteRoutes(app: FastifyInstance): void {
  app.post("/v1/invites", async (request, reply) => {
    const actor = await ownerOf(request, reply);
    if (!actor) return reply;

    const parsed = issueSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: "validation_failed" });

    const lifetime =
      parsed.data.expiresInSeconds !== undefined
        ? parsed.data.expiresInSeconds * 1000
        : parsed.data.expiresInHours !== undefined
          ? parsed.data.expiresInHours * HOUR_MS
          : undefined;

    const created = await issueInvite(
      {
        workspaceId: actor.workspaceId,
        participantId: actor.participantId,
        accountId: actor.accountId,
      },
      lifetime,
    );

    return reply.code(201).send({
      id: created.id,
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
    });
  });

  app.delete<{ Params: { id: string } }>("/v1/invites/:id", async (request, reply) => {
    const actor = await ownerOf(request, reply);
    if (!actor) return reply;

    const revoked = await revokeInvite(
      {
        workspaceId: actor.workspaceId,
        participantId: actor.participantId,
        accountId: actor.accountId,
      },
      request.params.id,
    );

    // Чужое и несуществующее — один ответ: иначе по нему перебирают.
    if (!revoked) return reply.code(404).send({ error: "invite_not_found" });
    return reply.code(204).send();
  });
}
