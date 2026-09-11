import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { askOwnBridge } from "../../../app/bridging.js";
import {
  issueBridgeCode,
  joinBridge,
  listBridges,
  markBridgeSeen,
  resolveBridge,
} from "../../../kernel/identity/index.js";
import { deliver, nextJob } from "../../../platform/rendezvous.js";
import { actorOf } from "./viewer.js";

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

/** Половина человека: сессию проверяет область дверей. */
export function registerBridgeHumanRoutes(app: FastifyInstance): void {
  app.post("/v1/bridges", async (request, reply) => {
    const actor = actorOf(request);

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

  app.get("/v1/bridges", async (request, _reply) => {
    const actor = actorOf(request);
    return { items: await listBridges(actor.participantId) };
  });

  /** Живая проверка: спросить настоящую модель через свой мост. */
  app.post<{ Body: { prompt?: string } }>("/v1/model/check", async (request, _reply) => {
    const actor = actorOf(request);

    const prompt = request.body?.prompt?.trim() || "Ответь одним словом: работает";

    // Нет моста — 503, молчит — 504, отказал — 502 (`failures.ts`):
    // чинит это человек, и чинит по-разному.
    return askOwnBridge(actor.participantId, prompt);
  });
}

/** Половина машины: удостоверение — заголовок `Authorization: Bridge`. */
export function registerBridgeMachineRoutes(app: FastifyInstance): void {
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
