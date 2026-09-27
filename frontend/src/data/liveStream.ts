import { eventOf, framed, nextDelay, retryAfterMs, type StreamEvent } from "@amplifie/contract";
import { liveTroubleOfStatus } from "../shared/trouble.js";

/**
 * Хозяин потока живых обновлений (task-093, срез 1).
 *
 * ⚠️ СВОЙ ЧИТАТЕЛЬ НА `fetch`, А НЕ `EventSource`, И ЭТО НЕ ВКУС.
 * `EventSource` не показывает ни кода ответа, ни заголовков, а на любой
 * ответ, кроме 200, закрывается НАВСЕГДА (WHATWG). Прожито живым прогоном:
 * `api` лежал 10 с, Caddy ответил 502 — и вкладка молчала до перезагрузки.
 * На нём нельзя ни отличить выкладку от кончившейся сессии, ни уважать
 * `Retry-After`. `fetch` видит и то и другое; нарезка потока — общая
 * с прибором нагрузки, из контракта.
 *
 * Чего хозяин НЕ делает: не догоняет и не знает про ленту. Он сообщает
 * «подключился» — что делать после этого, решает лента.
 */

export interface LiveStreamHandlers {
  onEvent: (event: StreamEvent) => void;
  /** Каждое удачное подключение, первое тоже. */
  onOpen: () => void;
  /** Сервер ответил 401: попыток больше не будет. */
  onSessionEnded: () => void;
  /** Сколько попыток подряд не удалось. Сбрасывается устойчивым подключением. */
  onTrouble?: (failures: number) => void;
}

/** Всё, что трогает внешний мир, — подменяемо: иначе поведение не проверить. */
export interface LiveStreamDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  random: () => number;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

const browser: LiveStreamDeps = {
  fetch: (url, init) => fetch(url, init),
  random: Math.random,
  now: Date.now,
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
};

/**
 * Сколько должно прожить соединение, чтобы считаться устойчивым.
 *
 * ⚠️ БЕЗ ЭТОГО ПОРОГА ОКНО НЕ РОСЛО БЫ У ПРОКСИ, КОТОРЫЙ ПРИНИМАЕТ
 * И ТУТ ЖЕ РВЁТ: каждое «открылось» сбрасывало бы счёт, и тысячи вкладок
 * стучались бы раз в секунду. Десять секунд — заведомо дольше такого
 * отказа и заведомо короче нормальной жизни потока (часы).
 */
const STABLE_MS = 10_000;

/**
 * Чем кончилась попытка подключиться: поток открыт, повторить (и не раньше
 * какого срока) или сессии больше нет.
 */
type Attempt =
  | { kind: "открыт"; body: ReadableStream<Uint8Array> }
  | { kind: "повторить"; floorMs: number }
  | { kind: "сессии нет" };

async function attempt(url: string, signal: AbortSignal, deps: LiveStreamDeps): Promise<Attempt> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      credentials: "include",
      headers: { accept: "text/event-stream" },
      signal,
    });
  } catch {
    return { kind: "повторить", floorMs: 0 };
  }
  if (liveTroubleOfStatus(response.status) === "сессии-нет") return { kind: "сессии нет" };
  // ⚠️ И ТИП ТОЖЕ: 200 от прокси со страницей ошибки — не поток. WHATWG
  // требует `text/event-stream`; без проверки такая страница считалась бы
  // открытым потоком, по которому никогда ничего не придёт.
  const isStream = response.headers.get("content-type")?.startsWith("text/event-stream") ?? false;
  if (response.ok && response.body && isStream) return { kind: "открыт", body: response.body };
  // Тело отказа не нужно, но непрочитанное держит соединение.
  void response.body?.cancel().catch(() => undefined);
  return {
    kind: "повторить",
    floorMs: retryAfterMs(response.headers.get("retry-after"), deps.now()),
  };
}

/** Читать поток до конца, отдавая события по одному. */
async function readEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const cut = framed(rest + decoder.decode(value, { stream: true }));
    rest = cut.rest;
    for (const block of cut.events) {
      const event = eventOf(block);
      if (event) onEvent(event);
    }
  }
}

/** Открыть поток. Возвращает закрытие: снять таймер и отменить чтение. */
export function openLiveStream(
  url: string,
  handlers: LiveStreamHandlers,
  deps: LiveStreamDeps = browser,
): () => void {
  let closed = false;
  let failures = 0;
  let timer: unknown;
  const controller = new AbortController();

  const retry = (floorMs: number) => {
    if (closed) return;
    failures += 1;
    handlers.onTrouble?.(failures);
    timer = deps.setTimeout(connect, nextDelay(failures - 1, deps.random, floorMs));
  };

  async function connect(): Promise<void> {
    timer = undefined;
    if (closed) return;
    const outcome = await attempt(url, controller.signal, deps);
    if (closed) return;
    if (outcome.kind === "сессии нет") {
      closed = true;
      handlers.onSessionEnded();
      return;
    }
    if (outcome.kind === "повторить") {
      retry(outcome.floorMs);
      return;
    }
    await listen(outcome.body);
  }

  /** Поток открыт: слушать до обрыва, потом вернуться. */
  async function listen(body: ReadableStream<Uint8Array>): Promise<void> {
    const openedAt = deps.now();
    handlers.onOpen();
    // Оборвался или отменён — чем кончилось, решается ниже, а не здесь.
    await readEvents(body, handlers.onEvent).catch(() => undefined);
    if (closed) return;
    if (deps.now() - openedAt >= STABLE_MS) failures = 0;
    retry(0);
  }

  void connect();

  return () => {
    closed = true;
    if (timer !== undefined) deps.clearTimeout(timer);
    controller.abort();
  };
}
