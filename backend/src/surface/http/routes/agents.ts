import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentsFor } from "../../../app/agents.js";
import {
  BadKeyFormatError,
  listKeys,
  NoSecretKeyError,
  resolveActor,
  revokeKey,
  saveKey,
} from "../../../kernel/identity/index.js";
import { parse } from "./parse.js";
import { SESSION_COOKIE, viewerOf } from "./viewer.js";

const keySchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  // Без `.trim()`: пробел внутри ключа — это другой ключ, и молча его
  // менять нельзя. Лишние пробелы по краям снимает клиент.
  key: z.string().min(1, "ключ пустой").max(400, "это не похоже на ключ"),
  scope: z.enum(["участник", "пространство"]).default("участник"),
});

/**
 * Отказ при сохранении ключа → код причины.
 *
 * Вынесено из маршрута: у того получалось четыре ветки поверх двух
 * проверок, и линтер сложности был прав.
 */
function keyFailure(error: unknown): { code: number; body: object } | null {
  if (error instanceof BadKeyFormatError) {
    // Текст ошибки уходит человеку на экран: в нём только ожидаемый
    // префикс, ни куска самого ключа.
    return { code: 422, body: { error: "bad_key_format", detail: error.message } };
  }
  if (error instanceof NoSecretKeyError) {
    // Отказ НАСТРОЙКИ стенда, а не человека. Разные починки, разные коды.
    return { code: 503, body: { error: "secrets_not_configured" } };
  }
  return null;
}

/** Кто спрашивает. Ключи — вещь участника, поэтому нужен и он, и арендатор. */

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

  /**
   * Сохранить ключ поставщика.
   *
   * ⚠️ В ОТВЕТЕ КЛЮЧА НЕТ И НЕ БУДЕТ. Возвращается подсказка из последних
   * знаков: узнать свой ключ по ней можно, воспользоваться — нет.
   * Это проверяется приёмочным тестом, который ищет ключ во всех ответах.
   */
  app.post("/v1/model-keys", async (request, reply) => {
    const actor = await viewerOf(request, reply);
    if (!actor) return reply;

    const input = parse(keySchema, request.body, reply);
    if (!input) return reply;

    try {
      return reply.code(201).send(await saveKey(actor, input));
    } catch (error) {
      const known = keyFailure(error);
      if (!known) throw error;
      return reply.code(known.code).send(known.body);
    }
  });

  /** Свои ключи и ключи пространства. Чужих личных здесь не бывает. */
  app.get("/v1/model-keys", async (request, reply) => {
    const actor = await viewerOf(request, reply);
    if (!actor) return reply;
    return { items: await listKeys(actor) };
  });

  /** Убрать ключ. Чужой личный неотличим от несуществующего — так и надо. */
  app.delete<{ Params: { id: string } }>("/v1/model-keys/:id", async (request, reply) => {
    const actor = await viewerOf(request, reply);
    if (!actor) return reply;

    const gone = await revokeKey(actor, request.params.id);
    if (!gone) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
