import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { signUp } from "../../../app/signUp.js";
import {
  type Actor,
  createInvite,
  EmailTakenError,
  InvalidCredentialsError,
  InviteNotUsableError,
  joinByInvite,
  login,
  logout,
  RegistrationClosedError,
  resolveActor,
  revokeInvite,
} from "../../../kernel/identity/index.js";
import { config } from "../../../platform/config.js";
import { parse } from "./parse.js";
import { SESSION_COOKIE, viewerOf } from "./viewer.js";

const registerSchema = z.object({
  email: z.email("нужен корректный адрес почты"),
  password: z.string().min(12, "пароль короче 12 символов"),
  displayName: z.string().trim().min(1, "как вас зовут?").max(80),
  workspaceName: z.string().trim().min(1, "название пространства пустое").max(120),
});

/**
 * Вход по приглашению — ОТДЕЛЬНАЯ дверь и отдельная схема (Р-009).
 *
 * ⚠️ РЕГИСТРАЦИЯ ПРО ТОКЕН НЕ ЗНАЕТ И НЕ УЗНАЕТ. Класс уязвимости, ради
 * которого это разделение и сделано: тот же токен, поданный через ДРУГОЙ
 * поток входа, обходил проверку доступа. Схема регистрации выше не имеет
 * поля `token`, и zod лишнее просто отбрасывает.
 */
const joinSchema = z.object({
  token: z.string().min(1),
  email: z.email("нужен корректный адрес почты"),
  password: z.string().min(12, "пароль короче 12 символов"),
  displayName: z.string().trim().min(1, "как вас зовут?").max(80),
});

/** Ссылка для команды. Верхнюю границу держит ещё и CHECK в базе. */
const inviteSchema = z.object({
  maxUses: z.number().int().min(1).max(500).optional(),
});

/**
 * Вход. ОТДЕЛЬНАЯ схема и отдельный обработчик: у входа проверки другие,
 * чем у регистрации, и смешивать их в одном пути нельзя.
 */
const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

function present(actor: Actor) {
  return {
    account: { id: actor.accountId, email: actor.email },
    participant: {
      id: actor.participantId,
      displayName: actor.displayName,
      kind: actor.kind,
      role: actor.role,
    },
    workspace: { id: actor.workspaceId, name: actor.workspaceName },
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/v1/auth/register", async (request, reply) => {
    const input = parse(registerSchema, request.body, reply);
    if (!input) return reply;

    try {
      const { actor, token } = await signUp(input);
      setSessionCookie(reply, token);
      return reply.code(201).send(present(actor));
    } catch (error) {
      if (error instanceof RegistrationClosedError) {
        // ⚠️ ГОВОРИМ ПРЯМО, А НЕ МОЛЧИМ. Скрывать тут нечего: «на этом
        // сервере уже есть компания» видно и по тому, что открывается
        // страница входа. Зато человек узнаёт, что делать дальше —
        // просить ссылку, а не подбирать пароль.
        return reply.code(403).send({ error: "registration_closed" });
      }
      if (error instanceof EmailTakenError) {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw error;
    }
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const input = parse(loginSchema, request.body, reply);
    if (!input) return reply;

    try {
      const { actor, token } = await login(input.email, input.password);
      setSessionCookie(reply, token);
      return reply.code(200).send(present(actor));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // Один и тот же ответ на «нет такой почты» и «неверный пароль».
        // Иначе по ответу перебирают, кто зарегистрирован.
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      throw error;
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  /**
   * ⚠️ ОДИН И ТОТ ЖЕ ОТКАЗ НА ЧЕТЫРЕ ПРИЧИНЫ: просрочено, отозвано,
   * исчерпано, нет такого. Разница в ответе — это способ перебрать живые
   * приглашения, и он бесплатен для того, кто перебирает.
   */
  app.post("/v1/auth/join", async (request, reply) => {
    const input = parse(joinSchema, request.body, reply);
    if (!input) return reply;

    try {
      const { actor, token } = await joinByInvite(input);
      setSessionCookie(reply, token);
      return reply.code(201).send(present(actor));
    } catch (error) {
      if (error instanceof InviteNotUsableError) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (error instanceof EmailTakenError) {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw error;
    }
  });

  app.post("/v1/invites", async (request, reply) => {
    const who = await viewerOf(request, reply);
    if (!who) return reply;
    const input = parse(inviteSchema, request.body ?? {}, reply);
    if (!input) return reply;

    const created = await createInvite(who, input);
    return reply.code(201).send({
      id: created.id,
      // Токен виден ОДИН раз, здесь. В базе только его хеш.
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
      maxUses: created.maxUses,
      used: created.used,
    });
  });

  app.delete("/v1/invites/:id", async (request, reply) => {
    const who = await viewerOf(request, reply);
    if (!who) return reply;

    const { id } = request.params as { id: string };
    // Чужое приглашение не находится — ровно как несуществующее.
    const revoked = await revokeInvite(who, id);
    return revoked ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
  });

  app.get("/v1/me", async (request, reply) => {
    const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
    if (!actor) return reply.code(401).send({ error: "not_authenticated" });
    return present(actor);
  });
}
