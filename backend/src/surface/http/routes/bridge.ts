import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bridgeAnswerBody,
  bridgeAnswered,
  bridgeArchiveBytes,
  bridgeFileParams,
  bridgeIssued,
  bridgeJob,
  bridgeJoinBody,
  bridgeJoined,
  bridgeList,
  failure,
  modelCheck,
  modelCheckBody,
  noContent,
} from "@amplifie/contract/api";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
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

/**
 * Мост одним архивом (task-065): его кладёт `npm run bridge:pack`, в образ
 * везёт Dockerfile. В имени — отпечаток содержимого: `npx` кеширует по
 * адресу, и новый мост обязан прийти по новому адресу, а не старым из кеша.
 */
const ARCHIVE_PATH = resolve("bridge/package/amplifie-bridge.tgz");
let archive: { name: string; bytes: Buffer } | undefined;

function bridgeArchive(): { name: string; bytes: Buffer } {
  if (!archive) {
    const bytes = readFileSync(ARCHIVE_PATH);
    const print = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    archive = { name: `amplifie-bridge-${print}.tgz`, bytes };
  }
  return archive;
}

/**
 * Адрес сайта, с которого человек взял строку: браузер шлёт `Origin` сам.
 * Подменить его может только тот, кто строку потом и запустит, — навредит себе.
 */
function siteOf(request: FastifyRequest): string {
  const origin = request.headers.origin;
  if (origin && URL.canParse(origin)) {
    const url = new URL(origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  }
  return `${request.protocol}://${request.host}`;
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

/** Половина человека: сессию проверяет область дверей. */
export function registerBridgeHumanRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/v1/bridges",
    { schema: { response: { 201: bridgeIssued } } },
    async (request, reply) => {
      const actor = actorOf(request);
      // Архив — до кода: нет архива, нет и строки, и незачем плодить запись моста.
      const { name } = bridgeArchive();
      const site = siteOf(request);

      const issued = await issueBridgeCode({
        workspaceId: actor.workspaceId,
        participantId: actor.participantId,
        accountId: actor.accountId,
      });

      // Готовая строка запуска — чтобы человеку осталось скопировать
      // и вставить, а не собирать команду из частей по инструкции. Одна для
      // cmd, PowerShell, bash и zsh: `npx` есть везде, где есть Node.
      return reply.code(201).send({
        id: issued.id,
        code: issued.code,
        command: `npx --yes ${site}/v1/bridge/package/${name} --url ${site} --code ${issued.code}`,
        expiresAt: issued.expiresAt.toISOString(),
      });
    },
  );

  app.get("/v1/bridges", { schema: { response: { 200: bridgeList } } }, async (request) => {
    const actor = actorOf(request);
    // Время — строкой ISO, как его везёт JSON и читает фронт (договор, Р-034).
    const items = (await listBridges(actor.participantId)).map((one) => ({
      ...one,
      lastSeenAt: one.lastSeenAt?.toISOString() ?? null,
      createdAt: one.createdAt.toISOString(),
    }));
    return { items };
  });

  /** Живая проверка: спросить настоящую модель через свой мост. */
  app.post(
    "/v1/model/check",
    {
      schema: {
        body: modelCheckBody.optional(),
        response: { 200: modelCheck, 502: failure, 503: failure, 504: failure },
      },
    },
    async (request) => {
      const actor = actorOf(request);

      const prompt = request.body?.prompt?.trim() || "Ответь одним словом: работает";

      // Нет моста — 503, молчит — 504, отказал — 502 (`failures.ts`):
      // чинит это человек, и чинит по-разному.
      return askOwnBridge(actor.participantId, prompt);
    },
  );
}

/** Удостоверение машины в описании API — схема `bridge` (`app.ts`). */
const BRIDGE_SECURITY = [{ bridge: [] }];

/** Половина машины: удостоверение — заголовок `Authorization: Bridge`. */
export function registerBridgeMachineRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  // Без удостоверения: машина, которая скачивает мост, ещё никто. Секретов
  // в архиве нет — это тот же мост, что человек и так запускает у себя.
  app.get(
    "/v1/bridge/package/:file",
    {
      schema: {
        params: bridgeFileParams,
        response: { 200: bridgeArchiveBytes, 404: failure },
      },
    },
    async (request, reply) => {
      const { name, bytes } = bridgeArchive();
      if (request.params.file !== name) return reply.code(404).send({ error: "not_found" });
      return reply
        .header("content-type", "application/gzip")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(bytes);
    },
  );

  app.post(
    "/v1/bridge/join",
    {
      schema: { body: bridgeJoinBody, response: { 200: bridgeJoined, 404: failure } },
    },
    async (request, reply) => {
      const joined = await joinBridge(request.body.code, request.body.name);
      // Нет такого кода, погашен, просрочен, отозван — снаружи одно и то же.
      if (!joined) return reply.code(404).send({ error: "not_found" });

      return reply.code(200).send({ id: joined.id, token: joined.token });
    },
  );

  app.get(
    "/v1/bridge/next",
    {
      schema: {
        security: BRIDGE_SECURITY,
        response: { 200: bridgeJob, 204: noContent, 401: failure },
      },
    },
    async (request, reply) => {
      const machine = await machineOf(request, reply);
      if (!machine) return reply;

      // Отмечаем заход ДО ожидания: именно по нему считается «на связи»,
      // и человек должен видеть подключение сразу, а не через 25 секунд.
      await markBridgeSeen(machine.id);

      const job = await nextJob(machine.id, HOLD_MS);
      // Пусто — нормальный исход, а не отказ: мост тут же приходит снова.
      if (!job) return reply.code(204).send(undefined);
      return reply.code(200).send(job);
    },
  );

  app.post(
    "/v1/bridge/answer",
    {
      schema: {
        security: BRIDGE_SECURITY,
        body: bridgeAnswerBody,
        response: { 200: bridgeAnswered, 401: failure },
      },
    },
    async (request, reply) => {
      const machine = await machineOf(request, reply);
      if (!machine) return reply;

      const { jobId, error, text } = request.body;
      const failed = error?.trim();
      await markBridgeSeen(machine.id);
      const outcome = deliver(jobId, failed ? { error: failed } : { text: text ?? "" });

      // «Никто не ждал» — не ошибка моста: срок вышел или сервер
      // перезапускался. Но и молчать нельзя: мост должен понимать,
      // что его работа никому не досталась.
      return reply.code(200).send({ outcome });
    },
  );
}
