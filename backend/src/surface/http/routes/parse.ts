import type { FastifyReply } from "fastify";
import type { z } from "zod";

/**
 * Разбор тела запроса по схеме. Одна копия на все маршруты.
 *
 * Было три одинаковых: в auth, chat и — чуть не появилась — в agents.
 * Три копии одной проверки расходятся не сразу, а через месяц, и тогда
 * один маршрут отвечает `validation_failed`, а другой пятисоткой.
 *
 * Ошибки собираются ПО ПОЛЯМ, а не строкой: клиент подсвечивает то поле,
 * в котором ошиблись, а не весь бланк целиком.
 */
export function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    // Первая ошибка на поле, а не последняя: человеку нужна причина,
    // а не полный перечень придирок.
    fields[key] ??= issue.message;
  }
  reply.code(422).send({ error: "validation_failed", fields });
  return null;
}
