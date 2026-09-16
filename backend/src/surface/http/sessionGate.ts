import { createHash } from "node:crypto";
import { normalizeIP } from "@fastify/rate-limit";

/**
 * Барьер до проверки сессии: адрес, с которого сыплются выдуманные печеньки
 * (task-093, слой 1).
 *
 * ЗАЧЕМ. Сессию с печенькой проверяет база. Порог частоты считался по строке
 * печеньки — и выдуманная печенька на каждом запросе получала новый счётчик:
 * порог не срабатывал никогда, а каждая попытка занимала соединение пула
 * из десяти (внешнее ревью 16.09, подтверждено приёмочным П-6).
 *
 * ⚠️ СЧИТАЮТСЯ ТОЛЬКО НЕУДАЧИ, А ПРОПУСКАЮТСЯ НЕДАВНО ПОДТВЕРЖДЁННЫЕ. Коробка
 * стоит в офисе, и десятки людей выходят наружу с одного адреса. Порог
 * на ВСЕ запросы адреса бил бы по всему офису; порог на неудачи — только
 * по тому, кто их устраивает. А когда адрес уже перешёл предел, человек
 * с настоящей сессией от чужого подбора не страдает: его печенька недавно
 * подтверждалась, и она идёт к проверке как обычно.
 *
 * ⚠️ ЭТО НЕ КЕШ ПРАВ. «Недавно подтверждённая» освобождает только от барьера:
 * права и живость сессии по-прежнему проверяет база на каждом запросе,
 * и выход действует немедленно.
 *
 * ГДЕ ЖИВЁТ. В памяти процесса, как и пороги частоты (Р-025): узел один.
 * Второй узел — порог пересмотра, как у шины и хвоста (Р-038).
 */

/** Сколько неудачных проверок с одного адреса терпим за окно. */
const WINDOW_MS = 60_000;

/** Сколько живёт отметка «эту печеньку сервер подтверждал». */
const CONFIRMED_MS = 15 * 60_000;

/**
 * Сколько отметок держим. Ограничение памяти, а не безопасности: вытесненная
 * отметка значит лишь, что её владелец при атаке с его адреса подождёт окно.
 */
const CONFIRMED_LIMIT = 50_000;

const failures = new Map<string, { count: number; resetAt: number }>();
const confirmed = new Map<string, number>();

/** Печенька не хранится в памяти как есть: отпечаток, а не сама строка. */
function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function addressOf(ip: string): string {
  return normalizeIP(ip);
}

/**
 * Пускать ли запрос к проверке сессии. `null` — пускать; число — сколько
 * секунд ждать (для `Retry-After`).
 */
export function gateWait(
  ip: string,
  token: string,
  limit: number,
  now = Date.now(),
): number | null {
  const window = failures.get(addressOf(ip));
  if (!window || window.resetAt <= now || window.count < limit) return null;
  const seenAt = confirmed.get(fingerprint(token));
  if (seenAt !== undefined && now - seenAt < CONFIRMED_MS) return null;
  return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
}

/** Проверка с печенькой не удалась. */
export function noteFailure(ip: string, now = Date.now()): void {
  const address = addressOf(ip);
  const window = failures.get(address);
  if (!window || window.resetAt <= now) {
    failures.set(address, { count: 1, resetAt: now + WINDOW_MS });
    // Карта адресов не растёт вечно: старые окна уходят при записи новых.
    if (failures.size > CONFIRMED_LIMIT) prune(now);
    return;
  }
  window.count += 1;
}

/** Сервер подтвердил сессию — при входе или проверкой. */
export function noteConfirmed(token: string, now = Date.now()): void {
  const key = fingerprint(token);
  // Удалить и вставить заново: порядок вставки — порядок свежести.
  confirmed.delete(key);
  confirmed.set(key, now);
  if (confirmed.size > CONFIRMED_LIMIT) {
    const oldest = confirmed.keys().next().value;
    if (oldest !== undefined) confirmed.delete(oldest);
  }
}

/** Сессия закрыта — отметка больше не освобождает от барьера. */
export function forgetConfirmed(token: string): void {
  confirmed.delete(fingerprint(token));
}

function prune(now: number): void {
  for (const [address, window] of failures) {
    if (window.resetAt <= now) failures.delete(address);
  }
}
