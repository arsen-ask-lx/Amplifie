import {
  agentsView,
  failure,
  idParams,
  keyBody,
  modelKeyList,
  modelKeyView,
  noContent,
} from "@amplifie/contract/api";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { agentsFor } from "../../../app/agents.js";
import { type KeyView, listKeys, revokeKey, saveKey } from "../../../kernel/identity/index.js";
import { linksTo } from "../links.js";
import { actorOf } from "./viewer.js";

/** Время — строкой ISO, как его везёт JSON и читает фронт (договор, Р-034). */
function presentKey(key: KeyView) {
  return { ...key, createdAt: key.createdAt.toISOString() };
}

/**
 * Раздел «Агенты»: кто есть в пространстве и через чей мост они отвечают.
 *
 * ⚠️ ТОЛЬКО ЧТЕНИЕ. Агент заводится при первом ответе (`ensureAgent`),
 * а не при взгляде на список. `GET`, который пишет, однажды заведёт
 * участника от чужого запроса, и журнал получит событие без причины.
 */
export function registerAgentRoutes(scope: FastifyInstance): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  app.get("/v1/agents", { schema: { response: { 200: agentsView } } }, async (request) => {
    const actor = actorOf(request);

    return agentsFor({
      participantId: actor.participantId,
      workspaceId: actor.workspaceId,
    });
  });

  /**
   * Сохранить ключ поставщика.
   *
   * ⚠️ В ОТВЕТЕ КЛЮЧА НЕТ И НЕ БУДЕТ. Возвращается подсказка из последних
   * знаков: узнать свой ключ по ней можно, воспользоваться — нет.
   * Это проверяется приёмочным тестом, который ищет ключ во всех ответах.
   */
  app.post(
    "/v1/model-keys",
    {
      schema: { body: keyBody, response: { 201: modelKeyView } },
      links: { 201: linksTo(["DELETE", "/v1/model-keys/{id}"]) },
    },
    async (request, reply) => {
      return reply.code(201).send(presentKey(await saveKey(actorOf(request), request.body)));
    },
  );

  /** Свои ключи и ключи пространства. Чужих личных здесь не бывает. */
  app.get("/v1/model-keys", { schema: { response: { 200: modelKeyList } } }, async (request) => {
    const actor = actorOf(request);
    return { items: (await listKeys(actor)).map(presentKey) };
  });

  /** Убрать ключ. Чужой личный неотличим от несуществующего — так и надо. */
  app.delete(
    "/v1/model-keys/:id",
    { schema: { params: idParams, response: { 204: noContent, 404: failure } } },
    async (request, reply) => {
      const actor = actorOf(request);

      const gone = await revokeKey(actor, request.params.id);
      if (!gone) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send(undefined);
    },
  );
}
