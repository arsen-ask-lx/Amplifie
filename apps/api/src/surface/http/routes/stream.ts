import type { FastifyInstance } from "fastify";
import { resolveActor } from "../../../kernel/identity/index.js";
import { subscribe } from "../../../platform/bus.js";
import { SESSION_COOKIE } from "./auth.js";

/**
 * Поток живых обновлений (Р-005). Звонок, а не доставка.
 *
 * Сообщение потока не несёт содержимого — только «в пространстве что-то
 * изменилось». Содержимое клиент забирает через `/v1/sync` по своему курсору:
 * тем же вызовом, которым догоняет после разрыва. Один путь на живое
 * и на восстановление — иначе они расходятся, и расходятся молча.
 */

/** Раз в 20 секунд, чтобы прокси не порвал молчащее соединение. */
const HEARTBEAT_MS = 20_000;

export function registerStreamRoutes(app: FastifyInstance): void {
  app.get("/v1/stream", async (request, reply) => {
    const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
    if (!actor) {
      // Именно отказ, а не пустой поток: висящий пустой поток снаружи
      // неотличим от исправного, и клиент будет ждать звонка вечно.
      return reply.code(401).send({ error: "not_authenticated" });
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform — страховка, а НЕ несущая деталь. Проверено опытом:
      // без него тесты остаются зелёными, потому что куски потока короче
      // порога сжатия Caddy. Заголовок оставлен на случай другого прокси
      // или другой настройки — но обольщаться нечем, и тест этого
      // не поймает. Ограничение названо, а не спрятано.
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Для прокси семейства nginx — та же просьба не буферизовать.
      "x-accel-buffering": "no",
    });

    // Первый байт сразу: пока в сокет ничего не ушло, часть прокси держит
    // ответ у себя, и клиент не знает, установлено соединение или нет.
    reply.raw.write(": поток открыт\n\n");

    // `id:` намеренно нет. Last-Event-ID нужен, чтобы восстановить
    // пропущенное, а у нас это делает /v1/sync по своему курсору.
    // Второй счётчик прогресса разошёлся бы с первым.
    const nudge = () => reply.raw.write("event: changed\ndata: {}\n\n");
    const unsubscribe = subscribe(actor.workspaceId, nudge);

    const heartbeat = setInterval(() => reply.raw.write(": тук\n\n"), HEARTBEAT_MS);

    // Отписка и таймер снимаются на ЛЮБОМ исходе: закрыл клиент, оборвалась
    // сеть, упал сервер соединения. Подписчик, переживший поток, — утечка,
    // которая тихо копится и проявляется через недели.
    const stop = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on("close", stop);
    request.raw.on("error", stop);

    // Fastify не должен закрывать ответ: поток живёт, пока жив клиент.
    return reply;
  });
}
