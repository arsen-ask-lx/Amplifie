import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { acceptInvite } from "../../../app/joinByInvite.js";
import { signUp } from "../../../app/signUp.js";
import {
  type Actor,
  EmailTakenError,
  InvalidCredentialsError,
  InviteNotUsableError,
  login,
  logout,
  resolveActor,
} from "../../../kernel/identity/index.js";
import { config } from "../../../platform/config.js";
import { parse } from "./parse.js";

export const SESSION_COOKIE = "amplifie_session";

const registerSchema = z.object({
  email: z.email("нужен корректный адрес почты"),
  password: z.string().min(12, "пароль короче 12 символов"),
  displayName: z.string().trim().min(1, "как вас зовут?").max(80),
  workspaceName: z.string().trim().min(1, "название пространства пустое").max(120),
});

/**
 * Вход по приглашению. ОТДЕЛЬНАЯ схема и отдельный обработчик — регистрация
 * приглашений не принимает никогда (Р-009). Один путь — один набор проверок.
 */
const joinSchema = z.object({
  token: z.string().min(1, "нужна ссылка-приглашение"),
  email: z.email("нужен корректный адрес почты"),
  password: z.string().min(12, "пароль короче 12 символов"),
  displayName: z.string().trim().min(1, "как вас зовут?").max(80),
});

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
      if (error instanceof EmailTakenError) {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw error;
    }
  });

  app.post("/v1/auth/join", async (request, reply) => {
    const input = parse(joinSchema, request.body, reply);
    if (!input) return reply;

    try {
      const { actor, token } = await acceptInvite(input);
      setSessionCookie(reply, token);
      return reply.code(201).send(present(actor));
    } catch (error) {
      if (error instanceof InviteNotUsableError) {
        // Нет, просрочено, отозвано, уже использовано — снаружи ОДНО И ТО ЖЕ.
        // Иначе по разнице ответов перебирают живые приглашения.
        return reply.code(404).send({ error: "invite_not_found" });
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

  app.get("/v1/me", async (request, reply) => {
    const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
    if (!actor) return reply.code(401).send({ error: "not_authenticated" });
    return present(actor);
  });
}
