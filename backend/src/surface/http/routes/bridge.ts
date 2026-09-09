import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NoBridgeError } from "../../../agent/model/bridge.js";
import { askOwnBridge } from "../../../app/bridging.js";
import {
  issueBridgeCode,
  joinBridge,
  listBridges,
  markBridgeSeen,
  resolveActor,
  resolveBridge,
} from "../../../kernel/identity/index.js";
import {
  BridgeFailedError,
  BridgeSilentError,
  deliver,
  nextJob,
} from "../../../platform/rendezvous.js";
import { SESSION_COOKIE } from "./viewer.js";

/**
 * Мост участника: своя подписка у каждого (task-001).
 *
 * Две половины с РАЗНЫМИ удостоверениями, и смешивать их нельзя:
 *   • `/v1/bridges` и `/v1/model/*` — человек, печенька сессии;
 *   • `/v1/bridge/*` — машина, заголовок `Authorization: Bridge <токен>`.
 *
 * Токен машины не пускает в интерфейс человека, а сессия не пускает
 * за работой моста. Слитые вместе, они дали бы машине права человека.
 */

/** Сколько мост стоит с открытой рукой, прежде чем уйти ни с чем. */
const HOLD_MS = 25_000;

/**
 * Отказ модели наружу: код и причина.
 *
 * Три разных состояния — три разных ответа. «Что-то пошло не так» здесь
 * бесполезно: чинит их человек, и чинит по-разному — один запускает мост,
 * другой ждёт, третий устанавливает клиент.
 */
function askFailure(error: unknown): { code: number; body: object } | null {
  if (error instanceof NoBridgeError) {
    return { code: 503, body: { error: "bridge_offline" } };
  }
  if (error instanceof BridgeSilentError) {
    return { code: 504, body: { error: "bridge_silent", detail: error.message } };
  }
  if (error instanceof BridgeFailedError) {
    return { code: 502, body: { error: "bridge_failed", detail: error.message } };
  }
  return null;
}

async function humanOf(request: FastifyRequest, reply: FastifyReply) {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return actor;
}

/** Токен машины из заголовка. Схема `Bridge`, а не `Bearer`: это не сессия. */
function bridgeToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bridge ")) return undefined;
  return header.slice("Bridge ".length).trim() || undefined;
}

async function machineOf(request: FastifyRequest, reply: FastifyReply) {
  const machine = await resolveBridge(bridgeToken(request));
  if (!machine) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return machine;
}

export function registerBridgeRoutes(app: FastifyInstance): void {
  /* ── половина человека ───────────────────────────────────────────── */

  app.post("/v1/bridges", async (request, reply) => {
    const actor = await humanOf(request, reply);
    if (!actor) return reply;

    const issued = await issueBridgeCode({
      workspaceId: actor.workspaceId,
      participantId: actor.participantId,
      accountId: actor.accountId,
    });

    // Готовая строка запуска — чтобы человеку осталось скопировать
    // и вставить, а не собирать команду из частей по инструкции.
    return reply.code(201).send({
      id: issued.id,
      code: issued.code,
      command: `npm run bridge -- --code ${issued.code}`,
      expiresAt: issued.expiresAt.toISOString(),
    });
  });

  app.get("/v1/bridges", async (request, reply) => {
    const actor = await humanOf(request, reply);
    if (!actor) return reply;
    return { items: await listBridges(actor.participantId) };
  });

  /** Живая проверка: спросить настоящую модель через свой мост. */
  app.post<{ Body: { prompt?: string } }>("/v1/model/check", async (request, reply) => {
    const actor = await humanOf(request, reply);
    if (!actor) return reply;

    const prompt = request.body?.prompt?.trim() || "Ответь одним словом: работает";

    try {
      return await askOwnBridge(actor.participantId, prompt);
    } catch (error) {
      const known = askFailure(error);
      // Незнакомая ошибка пробрасывается: глотать её здесь значит
      // превратить настоящую поломку в вежливый ответ.
      if (!known) throw error;
      return reply.code(known.code).send(known.body);
    }
  });

  /* ── половина машины ─────────────────────────────────────────────── */

  app.post<{ Body: { code?: string; name?: string } }>(
    "/v1/bridge/join",
    async (request, reply) => {
      const code = request.body?.code?.trim();
      const name = request.body?.name?.trim();
      if (!code || !name) {
        return reply.code(400).send({ error: "bad_request" });
      }

      const joined = await joinBridge(code, name);
      // Нет такого кода, погашен, просрочен, отозван — снаружи одно и то же.
      if (!joined) return reply.code(404).send({ error: "not_found" });

      return reply.code(200).send({ id: joined.id, token: joined.token });
    },
  );

  app.get("/v1/bridge/next", async (request, reply) => {
    const machine = await machineOf(request, reply);
    if (!machine) return reply;

    // Отмечаем заход ДО ожидания: именно по нему считается «на связи»,
    // и человек должен видеть подключение сразу, а не через 25 секунд.
    await markBridgeSeen(machine.id);

    const job = await nextJob(machine.id, HOLD_MS);
    // Пусто — нормальный исход, а не отказ: мост тут же приходит снова.
    if (!job) return reply.code(204).send();
    return reply.code(200).send(job);
  });

  app.post<{ Body: { jobId?: string; text?: string; error?: string } }>(
    "/v1/bridge/answer",
    async (request, reply) => {
      const machine = await machineOf(request, reply);
      if (!machine) return reply;

      const jobId = request.body?.jobId;
      if (!jobId) return reply.code(400).send({ error: "bad_request" });

      const failure = request.body?.error?.trim();
      const text = request.body?.text;
      if (!failure && typeof text !== "string") {
        return reply.code(400).send({ error: "bad_request" });
      }

      await markBridgeSeen(machine.id);
      const outcome = deliver(jobId, failure ? { error: failure } : { text: text ?? "" });

      // «Никто не ждал» — не ошибка моста: срок вышел или сервер
      // перезапускался. Но и молчать нельзя: мост должен понимать,
      // что его работа никому не досталась.
      return reply.code(200).send({ outcome });
    },
  );
}
