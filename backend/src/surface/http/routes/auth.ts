import {
  entryView,
  failure,
  idParams,
  inviteBody,
  inviteCreated,
  joinBody,
  loginBody,
  meView,
  noContent,
  registerBody,
} from "@amplifie/contract/api";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { signUp } from "../../../app/signUp.js";
import {
  type Actor,
  createInvite,
  joinByInvite,
  login,
  logout,
  registrationOpen,
  revokeInvite,
} from "../../../kernel/identity/index.js";
import { config } from "../../../platform/config.js";
import { INVITE, JOIN, LOGIN, REGISTER } from "../limits.js";
import { linksTo } from "../links.js";
import { forgetConfirmed, noteConfirmed } from "../sessionGate.js";
import { actorOf, SESSION_COOKIE } from "./viewer.js";

function setSessionCookie(reply: FastifyReply, token: string): void {
  // Сессия только что выдана — барьер выдуманных печенек её не задерживает
  // (task-093, `sessionGate.ts`): человек за NAT, где кто-то подбирает,
  // входит и сразу работает.
  noteConfirmed(token);
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

export function registerAuthRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  /**
   * Что за дверью, ДО входа: можно ли здесь завести компанию (task-023).
   *
   * ⚠️ БЕЗ СЕССИИ — ИНАЧЕ БЕССМЫСЛЕННО. Спрашивает тот, кто ещё никто:
   * экран решает, показать «Создать пространство» или «Вход».
   *
   * До этой ручки экран показывал обе двери всегда, и на занятой
   * установке вторая уверенно вела в 403.
   */
  app.get("/v1/entry", { schema: { response: { 200: entryView } } }, async () => {
    return { registrationOpen: await registrationOpen() };
  });

  app.post(
    "/v1/auth/register",
    {
      config: { rateLimit: REGISTER },
      schema: { body: registerBody, response: { 201: meView, 403: failure, 409: failure } },
    },
    async (request, reply) => {
      const input = request.body;

      // Закрытая регистрация отвечает 403 прямо (`failures.ts`): скрывать
      // нечего, а человек узнаёт, что просить надо ссылку, а не пароль.
      const { actor, token } = await signUp(input);
      setSessionCookie(reply, token);
      return reply.code(201).send(present(actor));
    },
  );

  app.post(
    "/v1/auth/login",
    {
      config: { rateLimit: LOGIN },
      schema: { body: loginBody, response: { 200: meView, 401: failure } },
    },
    async (request, reply) => {
      const input = request.body;

      // «Нет такой почты» и «неверный пароль» — один отказ 401: иначе
      // по ответу перебирают, кто зарегистрирован.
      const { actor, token } = await login(input.email, input.password);
      setSessionCookie(reply, token);
      return reply.code(200).send(present(actor));
    },
  );

  app.post(
    "/v1/auth/logout",
    { schema: { response: { 204: noContent } } },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) {
        await logout(token);
        forgetConfirmed(token);
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(204).send(undefined);
    },
  );

  /**
   * ⚠️ ОДИН И ТОТ ЖЕ ОТКАЗ НА ЧЕТЫРЕ ПРИЧИНЫ: просрочено, отозвано,
   * исчерпано, нет такого. Разница в ответе — это способ перебрать живые
   * приглашения, и он бесплатен для того, кто перебирает.
   */
  app.post(
    "/v1/auth/join",
    {
      config: { rateLimit: JOIN },
      schema: { body: joinBody, response: { 201: meView, 404: failure, 409: failure } },
    },
    async (request, reply) => {
      const input = request.body;

      const { actor, token } = await joinByInvite(input);
      setSessionCookie(reply, token);
      return reply.code(201).send(present(actor));
    },
  );
}

/** Двери того, кто уже вошёл: приглашения и «кто я». Сессию проверяет область. */
export function registerAccountRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/v1/invites",
    {
      config: { rateLimit: INVITE },
      schema: { body: inviteBody.optional(), response: { 201: inviteCreated } },
      links: { 201: linksTo(["DELETE", "/v1/invites/{id}"]) },
    },
    async (request, reply) => {
      const who = actorOf(request);
      const input = request.body ?? {};

      const created = await createInvite(who, input);
      return reply.code(201).send({
        id: created.id,
        // Токен виден ОДИН раз, здесь. В базе только его хеш.
        token: created.token,
        expiresAt: created.expiresAt.toISOString(),
        maxUses: created.maxUses,
        used: created.used,
      });
    },
  );

  app.delete(
    "/v1/invites/:id",
    { schema: { params: idParams, response: { 204: noContent, 404: failure } } },
    async (request, reply) => {
      const who = actorOf(request);

      const { id } = request.params;
      // Чужое приглашение не находится — ровно как несуществующее.
      const revoked = await revokeInvite(who, id);
      return revoked
        ? reply.code(204).send(undefined)
        : reply.code(404).send({ error: "not_found" });
    },
  );

  app.get("/v1/me", { schema: { response: { 200: meView } } }, async (request) =>
    present(actorOf(request)),
  );
}
