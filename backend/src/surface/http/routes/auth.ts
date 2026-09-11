import { idParams } from "@amplifie/contract/api";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
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
import { actorOf, SESSION_COOKIE } from "./viewer.js";

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
  // ⚠️ СВОИ СЛОВА, А НЕ УМОЛЧАНИЕ ПРОВЕРЯЛКИ. Без них пустая форма
  // отвечала «Too small: expected string to have >=1 characters» —
  // по-английски, языком библиотеки, прямо человеку на экран.
  // У регистрации слова были с первого дня, у входа их забыли.
  //
  // Длина здесь единица, а не двенадцать: у входа нет правил к паролю,
  // он проверяется совпадением. Рассказывать на входе, каким пароль
  // должен быть, значит подсказывать подбирающему.
  email: z.string().min(1, "введите почту"),
  password: z.string().min(1, "введите пароль"),
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
  app.get("/v1/entry", async () => {
    return { registrationOpen: await registrationOpen() };
  });

  app.post(
    "/v1/auth/register",
    { config: { rateLimit: REGISTER }, schema: { body: registerSchema } },
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
    { config: { rateLimit: LOGIN }, schema: { body: loginSchema } },
    async (request, reply) => {
      const input = request.body;

      // «Нет такой почты» и «неверный пароль» — один отказ 401: иначе
      // по ответу перебирают, кто зарегистрирован.
      const { actor, token } = await login(input.email, input.password);
      setSessionCookie(reply, token);
      return reply.code(200).send(present(actor));
    },
  );

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
  app.post(
    "/v1/auth/join",
    { config: { rateLimit: JOIN }, schema: { body: joinSchema } },
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
    { config: { rateLimit: INVITE }, schema: { body: inviteSchema.optional() } },
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

  app.delete("/v1/invites/:id", { schema: { params: idParams } }, async (request, reply) => {
    const who = actorOf(request);

    const { id } = request.params;
    // Чужое приглашение не находится — ровно как несуществующее.
    const revoked = await revokeInvite(who, id);
    return revoked ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
  });

  app.get("/v1/me", async (request) => present(actorOf(request)));
}
