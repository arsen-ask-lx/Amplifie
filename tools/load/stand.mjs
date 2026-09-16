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
 * ⚠️ ВКЛАДКА СМОТРИТ ОДИН РАЗГОВОР И ДОГОНЯЕТ ТОЛЬКО ПО СВОЕМУ АДРЕСУ.
 * Так ведёт себя клиент после task-067: звонок несёт адрес изменения,
 * и вкладка чужого разговора не идёт никуда. `watching` не задан —
 * догоняет на любой звонок, то есть ведёт себя как клиент ДО правки.
 * Оба поведения нужны: разницу между ними мы и меряем.
 *
 * ⚠️ НА ЗВОНОК ВКЛАДКА ИДЁТ В ДОГОН — И ЭТО НЕ УКРАШЕНИЕ ЗАМЕРА.
 * Без этого «вкладка» держит только соединение, а настоящий браузер
 * после каждого звонка зовёт `/v1/sync`. Замер без догона измеряет
 * раздачу пустых звонков и показывает ноль там, где у людей стадо
 * запросов к базе (Д-3). Проверено: 100 вкладок, 100 доставленных
 * событий, ноль лишних транзакций — потому что догона не было.
 * Поэтому догон включён по умолчанию, а выключается осознанно.
 */
export async function openTab(cookie, seen, { sync = true, watching = null, stats } = {}) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status === 429) throw new OwnRateLimitError("подключение к потоку");
  if (!response.ok || !response.body) throw new Error(`поток: ${response.status}`);

  void follow(response.body.getReader(), { cookie, seen, sync, watching, stats });
  return controller;
}

/** Читать поток до конца и вести себя на каждый звонок, как ведёт клиент. */
async function follow(reader, options) {
  const decoder = new TextDecoder();
  let cursor = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      cursor = await reacted(decoder.decode(value, { stream: true }), cursor, options);
    }
  } catch {
    // Поток закрыли — это конец замера, а не поломка.
  }
}

/** Что вкладка делает с прочитанным куском потока. Возвращает свой курсор. */
async function reacted(chunk, cursor, { cookie, seen, sync, watching, stats }) {
  // Событие приехало — только время и важно. Что именно приехало,
  // проверяют приёмочные, а не замер.
  if (!chunk.includes("data:")) return cursor;
  seen.push(Date.now());
  if (!sync) return cursor;

  /**
   * ⚠️ ПАНЕЛЬ ПЕРЕЧИТЫВАЕТСЯ НА ЛЮБОЙ ЗВОНОК, И ЭТО НЕ ВЫДУМКА
   * ЗАМЕРА, А ПОВЕДЕНИЕ КЛИЕНТА. В `useChat.ts` на каждое событие
   * стоит `rooms.reload()` без всяких условий: непрочитанное и порядок
   * меняются и от чужой реплики. Значит ВСЯКАЯ вкладка на ВСЯКое
   * событие идёт в `/v1/panel` — и это четыре запроса к базе против
   * одного у догона.
   *
   * До 16.09.2026 замер этого не делал и потому мерил пятую часть
   * цены события. Тот же класс ошибки, что и трижды до него:
   * прибор был зелёным потому, что не смотрел туда, где дорого.
   */
  await readPanel(cookie, stats);

  /**
   * ⚠️ ПОСЫЛКА ПРИМЕНЯЕТСЯ БЕЗ ЗАПРОСА — ТОЧНО ТАК ЖЕ, КАК ЭТО
   * ДЕЛАЕТ БРАУЗЕР (task-085). Номер идёт сразу за курсором — вкладка
   * показала реплику и никуда не пошла; любой разрыв — идёт в догон.
   *
   * Если стенд будет догонять там, где браузер не догоняет, цена события
   * окажется завышенной; если НЕ будет там, где браузер догоняет, —
   * заниженной. Второе опаснее: прибор покажет победу, которой нет.
   */
  const carried = lineOf(chunk);
  if (carried) {
    if (carried.seq === cursor + 1) return carried.seq;
    if (carried.seq > cursor) return caughtUp(cookie, cursor, stats);
    return cursor;
  }

  if (watching !== null && !addressed(chunk, watching)) return cursor;
  return caughtUp(cookie, cursor, stats);
}

/** Реплика из события, если сервер её прислал. */
function lineOf(chunk) {
  const line = chunk.split("\n").find((one) => one.startsWith("data:"));
  if (!line) return null;
  try {
    const { line: carried } = JSON.parse(line.slice("data:".length).trim() || "{}");
    return carried && typeof carried.seq === "number" ? carried : null;
  } catch {
    return null;
  }
}

/** Панель после звонка — так же, как её перечитывает браузер. */
async function readPanel(cookie, stats) {
  const response = await request("/v1/panel", { cookie });
  if (stats) {
    stats.panels = (stats.panels ?? 0) + 1;
    stats.queries += Number(response.headers.get("x-db-queries") ?? 0);
  }
  // Тело читаем и выбрасываем: непрочитанное тело держит соединение.
  await response.arrayBuffer();
}

/**
 * Догон, как его делает браузер: своим курсором и вперёд.
 *
 * ⚠️ СЧИТАЕМ ЦЕНУ ДОГОНА ЗАГОЛОВКОМ, А НЕ СЧЁТЧИКОМ БАЗЫ. Счётчик базы
 * (`pg_stat_database`) ловит и чужой фон — автовакуум, служебные задания, —
 * и на нём прирост плавал от 0,65 до −0,51 между прогонами. Заголовок
 * `x-db-queries` отдаёт сам сервер и ровно про этот запрос, поэтому число
 * получается детерминированным. В коробке заголовка нет, он только на стенде.
 */
async function caughtUp(cookie, cursor, stats) {
  const response = await request(`/v1/sync?after=${cursor}`, { cookie });
  if (stats) {
    stats.syncs += 1;
    stats.queries += Number(response.headers.get("x-db-queries") ?? 0);
  }
  if (!response.ok) return cursor;
  const page = await response.json();
  return typeof page.seq === "number" ? page.seq : cursor;
}

/**
 * Касается ли звонок того разговора, который смотрит эта вкладка.
 *
 * Звонок без адреса (`null`) касается всех: так сообщают об изменениях
 * пространства — заводке папки, переносе чата.
 */
function addressed(chunk, watching) {
  const line = chunk.split("\n").find((one) => one.startsWith("data:"));
  if (!line) return true;
  try {
    const { conversation } = JSON.parse(line.slice("data:".length).trim() || "{}");
    return conversation === null || conversation === undefined || conversation === watching;
  } catch {
    // Звонок не разобрался — ведём себя осторожно и догоняем.
    return true;
  }
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
