import type { FastifyInstance } from "fastify";
import { type Change, subscribe } from "../../../platform/bus.js";
import { COUNTERS, count, gauge } from "../../../platform/metrics.js";
import { STREAM, STREAM_OPEN } from "../limits.js";
import { actorOf } from "./viewer.js";

/**
 * Поток живых обновлений (Р-006). Звонок, а не доставка.
 *
 * Сообщение потока не несёт содержимого — только «в пространстве что-то
 * изменилось». Содержимое клиент забирает через `/v1/sync` по своему курсору:
 * тем же вызовом, которым догоняет после разрыва. Один путь на живое
 * и на восстановление — иначе они расходятся, и расходятся молча.
 */

/** Раз в 20 секунд, чтобы прокси не порвал молчащее соединение. */
const HEARTBEAT_MS = 20_000;

/**
 * Все открытые потоки — ради одного числа (Д-14, task-089).
 *
 * Сколько байт мы НАПИСАЛИ, а клиент ещё не забрал. Пока звонок
 * вез десяток байт адреса, это была мелочь. С task-085 в трубу едет
 * целая реплика — до восьми килобайт, — и медленный клиент копит их
 * в памяти ЕДИНСТВЕННОГО процесса. Отказ тут не плавный: кончается
 * память и падает ВСЁ сразу, а не у одного медленного.
 */
const open = new Set<{ raw: { writableLength: number } }>();

/**
 * Сколько незабранного терпим у ОДНОГО клиента (Д-14).
 *
 * Шестьдесят четыре килобайта — не красивое число, а арифметика под цель:
 * три тысячи вкладок × 64 КБ = 192 МБ в самом худшем случае, когда
 * ЗАЛИПЛИ ВСЕ СРАЗУ. При 256 КБ то же число даёт 768 МБ — для коробки
 * на чужом сервере это недопустимо.
 *
 * Здоровому клиенту предел не грозит вовсе: он вычитывает за миллисекунды,
 * и у него там ноль. Замерено изнутри сети стенда: один не читающий
 * накопил 472 КБ за 75 реплик, читающий сосед — ноль.
 */
const BACKLOG_LIMIT = 64 * 1024;

/** Сколько потоков открыто у каждого участника — ради предела `STREAM_OPEN`. */
const openByPerson = new Map<string, number>();

gauge("amplifie_stream_backlog_bytes", "написано, но клиентом не забрано", () => {
  let waiting = 0;
  for (const one of open) waiting += one.raw.writableLength;
  return waiting;
});

export function registerStreamRoutes(app: FastifyInstance): void {
  app.get(
    "/v1/stream",
    // Порог на ПОДКЛЮЧЕНИЕ, а не на сам поток: открытый живёт часами
    // и запросом больше не считается.
    { config: { rateLimit: STREAM } },
    async (request, reply) => {
      // Без сессии сюда не доходят: отказ 401 ставит область дверей,
      // и это именно отказ, а не пустой поток — висящий пустой поток
      // снаружи неотличим от исправного.
      const actor = actorOf(request);

      /**
       * ⚠️ ПРЕДЕЛ ОТКРЫТЫХ ПОТОКОВ ЧЕЛОВЕКА (task-093, слой 3). Порог частоты
       * считает попытки, а дорогое — то, что уже открыто и живёт часами:
       * дескриптор, память, место в раздаче. 429 с `Retry-After` клиент
       * понимает (`liveStream.ts`) и вернётся позже, а не будет ломиться.
       */
      const already = openByPerson.get(actor.participantId) ?? 0;
      if (already >= STREAM_OPEN.max) {
        return reply
          .code(429)
          .header("retry-after", String(STREAM_OPEN.retryAfterSeconds))
          .send({ error: "too_many_streams" });
      }
      openByPerson.set(actor.participantId, already + 1);

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
      // ⚠️ В `data` едет АДРЕС изменения и только он: идентификатор разговора
      // либо `null` — «изменилось пространство» (task-067). Ни текста,
      // ни автора: содержимое по-прежнему забирает `/v1/sync`. Вкладка,
      // у которой открыт другой разговор, по такому звонку не идёт никуда —
      // ради этого он и назван.
      /**
       * ⚠️ КТО НЕ ЗАБИРАЕТ — ТОГО ОБРЫВАЕМ, И ЭТО МИЛОСЕРДНЕЕ, ЧЕМ КАЖЕТСЯ.
       * Накопленное для мёртвой вкладки живёт в памяти ЕДИНСТВЕННОГО процесса —
       * того самого, который обслуживает всех остальных.
       *
       * Для самого клиента обрыв не потеря: он переподключается сам
       * (`frontend/src/data/liveStream.ts`), а пропущенное заберёт догоном
       * после подключения по своему курсору — тем же единственным
       * путём, который у нас уже написан и проверен. Это и есть graceful
       * degradation: плохо одному и ненадолго вместо «всем и насовсем».
       */
      const nudge = (change: Change) => {
        reply.raw.write(`event: changed\ndata: ${JSON.stringify(change)}\n\n`);
        if (reply.raw.writableLength <= BACKLOG_LIMIT) return;
        count(COUNTERS.streamsDropped);
        reply.raw.destroy();
      };
      const unsubscribe = subscribe(actor.workspaceId, actor.participantId, nudge);

      const heartbeat = setInterval(() => reply.raw.write(": тук\n\n"), HEARTBEAT_MS);

      // Отписка и таймер снимаются на ЛЮБОМ исходе: закрыл клиент, оборвалась
      // сеть, упал сервер соединения. Подписчик, переживший поток, — утечка,
      // которая тихо копится и проявляется через недели.
      open.add(reply);
      // Закрытие приходит и `close`, и `error` — место человека освобождается
      // ровно один раз, иначе счёт ушёл бы в минус и предел перестал держать.
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat);
        unsubscribe();
        open.delete(reply);
        const left = (openByPerson.get(actor.participantId) ?? 1) - 1;
        if (left > 0) openByPerson.set(actor.participantId, left);
        else openByPerson.delete(actor.participantId);
      };
      request.raw.on("close", stop);
      request.raw.on("error", stop);

      // Fastify не должен закрывать ответ: поток живёт, пока жив клиент.
      return reply;
    },
  );
}
