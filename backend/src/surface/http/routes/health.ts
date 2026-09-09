import type { FastifyInstance } from "fastify";
import { config } from "../../../platform/config.js";
import { appliedMigrations, pingDatabase } from "../../../platform/db.js";

/**
 * Дверь «жив ли ты» — и заодно единственный способ спросить установку,
 * ЧТО В НЕЙ СТОИТ (Р-030 ⑥).
 *
 * ⚠️ ВЕРСИЯ И ЧИСЛО МИГРАЦИЙ ОТДАЮТСЯ ЗДЕСЬ, А НЕ ПРЯЧУТСЯ В ЛОГАХ. Коробка
 * живёт на чужом сервере, и домой мы не звоним (Р-024). Значит на вопрос
 * поддержки «какая у вас версия и докуда накатаны миграции» человек обязан
 * уметь ответить сам, не пересылая скриншотов и не лазая в контейнер.
 *
 * Дверь остаётся открытой без входа: она уже такая, её дёргает и проверка
 * здоровья контейнера. Ничего чувствительного здесь нет — ни адресов,
 * ни имён, ни чисел о людях.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    try {
      await pingDatabase();
      return {
        status: "ok",
        database: "ok",
        // Обе величины могут быть `null`, и это честный ответ, а не пропуск:
        // «собрано мимо выпуска» и «журнала миграций ещё нет» — настоящие
        // состояния, и врать вместо них прочерком нельзя.
        version: config.version,
        migrations: await appliedMigrations(),
      };
    } catch (error) {
      app.log.error({ err: error }, "health: база недоступна");
      return reply.code(503).send({ status: "degraded", database: "unreachable" });
    }
  });
}
