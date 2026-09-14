/**
 * Общий стенд для замеров: вход, приглашение, открытая вкладка.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Замеров стало два — темп доставки (`measure.mjs`)
 * и цена события в запросах к базе (`db-per-event.mjs`). Вход, приглашение
 * и чтение потока у них одни и те же; вторая копия разошлась бы с первой
 * при первом же изменении порогов, и два замера начали бы мерить разные
 * стенды, не сообщив об этом.
 *
 * ⚠️ ИМЕНА ЛАТИНИЦЕЙ, ХОТЯ ОСТАЛЬНОЙ КОД ПО-РУССКИ. Переменную окружения
 * с кириллицей оболочка не примет: `ВКЛАДОК=3 node ...` падает
 * с «command not found». Проверено, а не предположено.
 */

export const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

const password = "ochen-dlinnyi-parol-dlya-zamera";

/**
 * Сколько вкладок открывает один человек.
 *
 * ⚠️ ВОСЕМЬ, А НЕ ОДНА. Порог подключений к потоку — десять в минуту
 * на человека (Р-025), и восемь оставляет запас. Заодно это ближе
 * к жизни: одна и та же почта открыта и на работе, и дома.
 *
 * И это единственный способ померить восемьсот вкладок, не уперевшись
 * в НАШ порог входа по приглашению: восемьсот входов в минуту он
 * не пропустит и правильно сделает.
 */
export const TABS_PER_PERSON = 8;

/** Упёрлись в СВОЙ порог частоты, а не в предел сервера (Р-025). */
export class OwnRateLimitError extends Error {}

export function emailFor(tag) {
  return `load-${Date.now()}-${tag}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export async function request(path, { method = "GET", body, cookie } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function cookieOf(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((one) => one.startsWith("amplifie_session="));
  const value = header ? header.split(";")[0] : null;
  if (!value) throw new Error("сервер не выдал печеньку сессии");
  return value;
}

/** Завести владельца со своим пространством. */
export async function registerOwner() {
  const response = await request("/v1/auth/register", {
    method: "POST",
    body: {
      email: emailFor("owner"),
      password: password,
      displayName: "Замер",
      workspaceName: `Замер ${new Date().toISOString().slice(11, 19)}`,
    },
  });
  if (!response.ok) throw new Error(`регистрация владельца: ${response.status}`);
  const cookie = cookieOf(response);
  const rooms = await request("/v1/panel", { cookie });
  const list = await rooms.json();
  const room = list.recent?.items?.[0]?.id ?? list.items?.[0]?.id;
  if (!room) throw new Error("у нового пространства нет канала");
  return { cookie, room };
}

/** Одна ссылка на всех: столько же, сколько сделал бы человек. */
export async function inviteLink(cookie, uses) {
  const response = await request("/v1/invites", {
    method: "POST",
    body: { maxUses: Math.min(500, uses + 5) },
    cookie,
  });
  if (!response.ok) throw new Error(`приглашение: ${response.status}`);
  return (await response.json()).token;
}

export async function joined(token, tag) {
  const response = await request("/v1/auth/join", {
    method: "POST",
    body: { token, email: emailFor(tag), password: password, displayName: `Гость ${tag}` },
  });
  if (response.status === 429) throw new OwnRateLimitError("вход по приглашению");
  if (!response.ok) throw new Error(`вход по ссылке: ${response.status}`);
  return cookieOf(response);
}

/**
 * Открытая вкладка: держит поток и ведёт себя как настоящий клиент.
 *
 * ⚠️ ЧИТАЕМ ПОТОК ПОБАЙТНО, А НЕ ЖДЁМ КОНЦА. Поток не кончается никогда;
 * `response.text()` на нём висел бы вечно, и замер молча показал бы ноль
 * событий при живом сервере.
 *
 * ⚠️ НА ЗВОНОК ВКЛАДКА ИДЁТ В ДОГОН — И ЭТО НЕ УКРАШЕНИЕ ЗАМЕРА.
 * Без этого «вкладка» держит только соединение, а настоящий браузер
 * после каждого звонка зовёт `/v1/sync`. Замер без догона измеряет
 * раздачу пустых звонков и показывает ноль там, где у людей стадо
 * запросов к базе (Д-3). Проверено: 100 вкладок, 100 доставленных
 * событий, ноль лишних транзакций — потому что догона не было.
 * Поэтому догон включён по умолчанию, а выключается осознанно.
 */
export async function openTab(cookie, seen, { sync = true } = {}) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status === 429) throw new OwnRateLimitError("подключение к потоку");
  if (!response.ok || !response.body) throw new Error(`поток: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let cursor = 0;
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        // Событие приехало — только время и важно. Что именно приехало,
        // проверяют приёмочные, а не замер.
        if (!decoder.decode(value, { stream: true }).includes("data:")) continue;
        seen.push(Date.now());
        if (!sync) continue;
        const caught = await request(`/v1/sync?after=${cursor}`, { cookie });
        if (!caught.ok) continue;
        const page = await caught.json();
        if (typeof page.seq === "number") cursor = page.seq;
      }
    } catch {
      // Поток закрыли — это конец замера, а не поломка.
    }
  })();
  return controller;
}

/**
 * Открыть N вкладок, распределив их по людям.
 *
 * Возвращает то, что нужно погасить в конце: подписчик, переживший замер,
 * держит соединение и портит следующий прогон.
 */
export async function openTabs(token, count, seen, onProgress, options) {
  const held = [];
  for (let opened = 0; opened < count; ) {
    const cookie = await joined(token, `tab${opened}`);
    for (let n = 0; n < TABS_PER_PERSON && opened < count; n++, opened++) {
      held.push(await openTab(cookie, seen, options));
      if (opened % 50 === 0) onProgress?.(opened, count);
    }
  }
  return held;
}
