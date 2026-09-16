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

import { fork } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { framed, nextDelay, retryAfterMs } from "./sse.mjs";

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

/**
 * Своя задержка событийного цикла — ПРИБОР МЕРИТ СЕБЯ (task-091, П-0).
 *
 * ⚠️ ЭТО ЗАМЕНА ВТОРОЙ МАШИНЕ, А НЕ ДОБАВКА К ОТЧЁТУ. «Дальше 800 вкладок
 * мы мерим генератор» было преданием: числа, подтверждающего границу,
 * не существовало ни одного. Держатель, у которого очередь на единственный
 * поток, отдаёт СВОЮ задержку как время сервера — и замер тихо врёт
 * тем больше, чем ближе к интересному месту.
 *
 * Тот же приём, что у сервера в `platform/metrics.ts`: 0.99, а не среднее,
 * потому что среднее прячет как раз тех, кому плохо. Монитор заводится
 * на процесс: и у держателя, и у родителя-отправителя он свой, и это
 * правильно — очередь у них разная.
 */
const ownLoop = monitorEventLoopDelay({ resolution: 10 });
ownLoop.enable();

/** 0.99 собственной задержки этого процесса, в миллисекундах. */
export function ownLagMs() {
  return ownLoop.percentile(99) / 1e6;
}

/**
 * Выше этого прибор считается узким местом, и числа прогона не идут в зачёт.
 *
 * Пятьдесят миллисекунд — двадцатая часть той секунды, которую мы обещаем
 * как 0.99 отклика. Прибор, стоящий в очереди дольше, уже вписывает
 * в результат заметную долю себя.
 */
export const CLEAR_LAG_MS = 50;

/**
 * Сказать, можно ли верить числам этого прогона.
 *
 * Отдаёт `true`, когда верить НЕЛЬЗЯ: прибор занят собой. Смотрит худшего
 * из держателей, а не среднего: один вставший портит замер целиком,
 * а среднее его спрячет.
 */
export function reportLag(workersWorstMs = 0) {
  const mine = ownLagMs();
  const worst = Math.max(mine, workersWorstMs);
  const where = `отправитель ${mine.toFixed(0)} мс, худший держатель ${workersWorstMs.toFixed(0)} мс`;
  if (worst < CLEAR_LAG_MS) {
    console.log(`  прибор свободен: 0.99 своей задержки ${worst.toFixed(0)} мс (${where})`);
    return false;
  }
  console.log(`  ⚠️ ПРИБОР ЗАНЯТ СОБОЙ: 0.99 своей задержки ${worst.toFixed(0)} мс (${where})`);
  console.log(
    `  это больше ${CLEAR_LAG_MS} мс — числа выше содержат нашу очередь, а не только сервер.`,
  );
  console.log("  выше этой ступени лестницы замер не засчитывается: упор здесь, а не на сервере");
  return true;
}

export function emailFor(tag) {
  return `load-${Date.now()}-${tag}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/**
 * Сколько раз сервер ответил 429, и каким дверям.
 *
 * ⚠️ ЭТО ГЛАВНЫЙ СТОРОЖ ЗАМЕРА, А НЕ УКРАШЕНИЕ ОТЧЁТА (task-091).
 * Общий порог частоты у нас 5000 в минуту НА АДРЕС
 * (`surface/http/limits.ts`, `OVERALL`), и ключа у него нет — значит
 * ключ адрес. Генератор на отдельной машине приходит с ОДНОГО адреса,
 * а 3000 вкладок дают три тысячи подключений плюс входы, перечитывания
 * панели и догоны: это заметно больше пяти тысяч в минуту.
 *
 * Без этого счётчика мы упёрлись бы в СВОЙ порог и записали его как
 * предел сервера. Молча: `readPanel` не смотрел на код ответа вовсе,
 * а догон при неуспехе просто возвращал прежний курсор. Ровно тот класс
 * ошибки, на котором прибор соврал пять раз за 16.09.2026.
 */
const refused = new Map();

/** Дверь без имён и запроса: `/v1/conversations/<uuid>/messages` → `.../:id/messages`. */
function doorOf(path) {
  return path
    .split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, ":id");
}

function refusal(path) {
  const door = doorOf(path);
  refused.set(door, (refused.get(door) ?? 0) + 1);
}

/** Кому и сколько раз отказали по частоте. Пусто — отказов не было. */
export function refusals() {
  return Object.fromEntries(refused);
}

/**
 * Сказать вслух, были ли отказы по частоте.
 *
 * Отдаёт `true`, когда замер НЕЛЬЗЯ считать доказанным: числа выше
 * рассказывают про наш порог, а не про сервер.
 */
export function reportRefusals(extra = {}) {
  const all = { ...refusals() };
  for (const [door, times] of Object.entries(extra)) {
    all[door] = (all[door] ?? 0) + times;
  }
  const total = Object.values(all).reduce((sum, one) => sum + one, 0);
  if (total === 0) {
    console.log("  отказов по частоте (429): 0 — упёрлись не в свой порог");
    return false;
  }
  const where = Object.entries(all)
    .map(([door, times]) => `${door} ×${times}`)
    .join(", ");
  console.log(`  ⚠️ ОТКАЗОВ ПО ЧАСТОТЕ (429): ${total} — ${where}`);
  console.log("  числа выше рассказывают про НАШ порог, а не про предел сервера");
  return true;
}

export async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Единственное место, где считается отказ по частоте: разойдись счёт
  // по вызывающим — половина забыла бы, и забывший показал бы ноль.
  if (response.status === 429) refusal(path);
  return response;
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
  const response = await connectStream(cookie, controller.signal);
  if (response.status === 429) throw new OwnRateLimitError("подключение к потоку");
  if (!response.ok || !response.body) throw new Error(`поток: ${response.status}`);

  // У каждой вкладки своё окно — как у каждого браузера своё.
  const panel = coalesced(() => void readPanel(cookie, stats), PANEL_WINDOW_MS);
  const tab = { cookie, seen, sync, watching, stats, panel, cursor: 0, signal: controller.signal };
  void live(response.body, tab);
  return controller;
}

/** Подключиться к потоку. 429 считается здесь: поток идёт мимо `request`. */
async function connectStream(cookie, signal) {
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
    signal,
  });
  if (response.status === 429) refusal("/v1/stream");
  return response;
}

/** Сколько должно прожить соединение, чтобы окно повтора сбросилось. */
const STABLE_MS = 10_000;

function bump(stats, name) {
  if (stats) stats[name] = (stats[name] ?? 0) + 1;
}

/**
 * Слушать поток, а оборвался — вернуться, как это делает клиент (task-093).
 *
 * ⚠️ ТОТ ЖЕ ПОРЯДОК, ЧТО У `frontend/src/data/useLiveUpdates.ts`, И ТЕ ЖЕ
 * ЧИСЛА ИЗ КОНТРАКТА. Задержка — `nextDelay`, срок сервера — `retryAfterMs`,
 * сброс окна — после десяти секунд жизни соединения. После возвращения —
 * догон и панель. Раньше вкладка прибора, как и старый клиент, после обрыва
 * молчала до конца замера, и «волну переподключений» мерить было нечем.
 *
 * Сам порядок «подключился → догнал» здесь всё же копия: клиентский код
 * живёт рядом с React и в Node не запускается. Копия названа, её числа —
 * общие.
 */
async function live(firstBody, tab) {
  let body = firstBody;
  let failures = 0;
  for (let first = true; body; first = false) {
    if (!first) {
      bump(tab.stats, "reconnects");
      await catchUpAfterReconnect(tab);
      tab.panel();
    }
    const openedAt = Date.now();
    await follow(body.getReader(), tab);
    if (tab.signal.aborted) return;
    if (Date.now() - openedAt >= STABLE_MS) failures = 0;
    ({ body, failures } = await reconnect(tab, failures));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Вернуться к потоку по правилу клиента. `body: null` — возвращаться некуда. */
async function reconnect(tab, startFailures) {
  let failures = startFailures;
  let floorMs = 0;
  for (;;) {
    await sleep(nextDelay(failures, Math.random, floorMs));
    failures += 1;
    if (tab.signal.aborted) return { body: null, failures };
    let response;
    try {
      response = await connectStream(tab.cookie, tab.signal);
    } catch {
      floorMs = 0;
      continue;
    }
    if (response.status === 401) {
      bump(tab.stats, "sessionEnded");
      return { body: null, failures };
    }
    if (response.ok && response.body) return { body: response.body, failures };
    floorMs = retryAfterMs(response.headers.get("retry-after"), Date.now());
    await response.body?.cancel().catch(() => undefined);
  }
}

/** Догнать после возвращения; отказ — повтор по тому же правилу, а не сдача. */
async function catchUpAfterReconnect(tab) {
  if (!tab.sync) return;
  for (let failures = 0; !tab.signal.aborted; failures++) {
    const page = await syncOnce(tab.cookie, tab.cursor, tab.stats).catch(() => null);
    if (page?.ok) {
      tab.cursor = page.cursor;
      return;
    }
    bump(tab.stats, "syncFailures");
    await sleep(nextDelay(failures, Math.random));
  }
}

/**
 * Читать поток до конца и вести себя на каждый звонок, как ведёт клиент.
 *
 * ⚠️ ПО СОБЫТИЯМ, А НЕ ПО КУСКАМ СОКЕТА (task-091). Здесь каждый `read()`
 * считался одним событием: под нагрузкой два слипшихся события давали
 * одно применённое и одно потерянное, потеря — «разрыв», разрыв — догон
 * и панель у трёх тысяч вкладок сразу. Шторм устраивал прибор, а не
 * сервер: браузер режет поток на события сам.
 */
async function follow(reader, tab) {
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const cut = framed(rest + decoder.decode(value, { stream: true }));
      rest = cut.rest;
      for (const one of cut.events) tab.cursor = await reacted(one, tab.cursor, tab);
    }
  } catch {
    // Оборвался или закрыт — решает `live`: вернуться или закончить.
  }
}

/** Что вкладка делает с прочитанным куском потока. Возвращает свой курсор. */
async function reacted(chunk, cursor, { cookie, seen, sync, watching, stats, panel }) {
  // Событие приехало — только время и важно. Что именно приехало,
  // проверяют приёмочные, а не замер.
  if (!chunk.includes("data:")) return cursor;
  seen.push(Date.now());
  if (!sync) return cursor;

  /**
   * ⚠️ ПОСЫЛКА ПРИМЕНЯЕТСЯ БЕЗ ЗАПРОСА — ТОЧНО ТАК ЖЕ, КАК ЭТО
   * ДЕЛАЕТ БРАУЗЕР (task-085). Номер идёт сразу за курсором — вкладка
   * показала реплику и никуда не пошла; любой разрыв — идёт в догон.
   *
   * Если стенд будет догонять там, где браузер не догоняет, цена события
   * окажется завышенной; если НЕ будет там, где браузер догоняет, —
   * заниженной. Второе опаснее: прибор покажет победу, которой нет.
   */
  /**
   * ⚠️ ПАНЕЛЬ ПЕРЕЧИТЫВАЕТСЯ ТОЛЬКО ТАМ, ГДЕ ЕЁ ПЕРЕЧИТЫВАЕТ КЛИЕНТ,
   * И ЭТО ПЯТЫЙ РАЗ, КОГДА СТЕНД УЧАТ ВЕСТИ СЕБЯ КАК ОРИГИНАЛ.
   *
   * До task-092 клиент звал панель на ЛЮБОЙ звонок, и стенд звал тоже
   * (научился этому 16.09, до того мерил пятую часть цены события).
   * Теперь в `useChat.ts` панель перечитывается, только если посылку
   * применить не вышло: разрыв, правка, удаление, изменение пространства.
   * Применённая реплика правит строку панели на клиенте и никуда не идёт.
   *
   * Разойдись стенд с клиентом в эту сторону — он показал бы победу,
   * которой нет: перечитываний ноль потому, что их не делает ПРИБОР.
   */
  const carried = lineOf(chunk);
  if (carried) {
    // Применили — панель поправилась сама, запроса нет.
    if (carried.seq === cursor + 1) return carried.seq;
    // Разрыв — догон И панель заново: приращению после разрыва веры нет.
    if (carried.seq > cursor) {
      panel();
      return caughtUp(cookie, cursor, stats);
    }
    // «Уже видели» — повтор звонка, не делаем ничего.
    return cursor;
  }

  // Звонок без посылки: правка, удаление, закрепление, дела пространства.
  panel();
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

/**
 * Сколько вкладка держит окно между перечитываниями панели.
 *
 * ⚠️ ЭТО ВТОРАЯ КОПИЯ ЧИСЛА, И Я ГОВОРЮ ОБ ЭТОМ ВСЛУХ.
 * Настоящее живёт в `frontend/src/data/useRooms.ts` (`PANEL_WINDOW_MS`).
 * Стенд — подделка клиента, и подделка обязана вести себя как оригинал;
 * импортировать число оттуда нельзя — там рядом React.
 *
 * Разойдутся — замер соврёт, и направление вранья названо: окно
 * больше клиентского — цена выйдет заниженной (покажет победу,
 * которой нет), меньше — завышенной. За сегодня это четвёртый
 * случай, когда стенд вёл себя не как клиент.
 */
const PANEL_WINDOW_MS = Number(process.env.PANEL_WINDOW_MS ?? 3000);

/**
 * То же правило, что у клиента (`frontend/src/data/coalesced.ts`):
 * сразу, потом не чаще раза в окно, и хвост обязателен.
 */
function coalesced(run, windowMs) {
  let closing;
  let waiting = false;
  const fire = () => {
    run();
    closing = setTimeout(() => {
      closing = undefined;
      if (!waiting) return;
      waiting = false;
      fire();
    }, windowMs);
    // Окно не должно держать процесс живым после конца замера.
    closing.unref?.();
  };
  return () => {
    if (closing) {
      waiting = true;
      return;
    }
    fire();
  };
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
  return (await syncOnce(cookie, cursor, stats)).cursor;
}

/** Один проход догона: удался ли и куда встал курсор. */
async function syncOnce(cookie, cursor, stats) {
  const response = await request(`/v1/sync?after=${cursor}`, { cookie });
  if (stats) {
    stats.syncs += 1;
    stats.queries += Number(response.headers.get("x-db-queries") ?? 0);
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    return { ok: false, cursor };
  }
  const page = await response.json();
  return { ok: true, cursor: typeof page.seq === "number" ? page.seq : cursor };
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

/**
 * Держатели вкладок — ОТДЕЛЬНЫМИ ПРОЦЕССАМИ, и это не украшение.
 *
 * Пока вкладки и отправка жили в одном процессе Node, замер мерил СЕБЯ:
 * 400 вкладок давали 4,8 с при свободном сервере. Сто вкладок на процесс —
 * тогда ни один не становится узким местом раньше сервера.
 *
 * Живёт здесь, а не в гейте: держатели нужны всем замерам, и вторая
 * копия разошлась бы с первой при первой же правке.
 */
const PER_WORKER = 100;

export async function holdTabs(token, watching, count, perWorker = PER_WORKER) {
  const workers = [];
  const each = Math.max(1, perWorker);
  for (let left = count; left > 0; left -= each) {
    workers.push(await oneWorker(token, watching, Math.min(each, left)));
  }
  return workers;
}

function oneWorker(token, watching, count) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL("./tabs-worker.mjs", import.meta.url), { stdio: "inherit" });
    child.on("message", (message) => {
      if (message.failed) reject(new Error(message.failed));
      else if (message.ready !== undefined) resolve({ child, tabs: message.ready });
    });
    child.on("error", reject);
    /**
     * ⚠️ УМЕРШИЙ ДЕРЖАТЕЛЬ ОБЯЗАН УРОНИТЬ ЗАМЕР, А НЕ ПОДВЕСИТЬ ЕГО.
     *
     * Без этой строки замер на 3000 вкладках висел двенадцать минут
     * с нулём открытых труб: держатели падали на `UND_ERR_CONNECT_TIMEOUT`,
     * родитель ждал от них сообщения, а прислать его было уже некому —
     * процесс умер необработанным отказом, то есть мимо `failed`
     * и мимо `error`. Тихий отказ в чистом виде, и в приборе, который
     * ровно для ловли тихих отказов и написан.
     *
     * `exit` приходит и после удачи — тогда обещание уже исполнено,
     * и повторное решение ничего не делает.
     */
    child.on("exit", (code, signal) => {
      reject(new Error(`держатель вкладок умер, не открыв их: код ${code ?? signal}`));
    });
    child.send({ open: { token, count, watching } });
  });
}

/** Сложить отказы двух отчётов по дверям. */
function merged(into, added = {}) {
  const all = { ...into };
  for (const [door, times] of Object.entries(added)) all[door] = (all[door] ?? 0) + times;
  return all;
}

/** Погасить держателей и собрать, во что обошлись их вкладки. */
export async function releaseTabs(workers) {
  const reports = await Promise.all(
    workers.map(
      (one) =>
        new Promise((resolve) => {
          one.child.on("message", (message) => {
            if (message.queries !== undefined) resolve(message);
          });
          // Умер, не отчитавшись, — берём пустой отчёт и идём дальше:
          // ждать вечно хуже, чем недосчитать одного из тридцати. То, что
          // его нет, видно по числу увиденных событий.
          one.child.on("exit", () => resolve({ seen: 0, syncs: 0, panels: 0, queries: 0 }));
          one.child.send({ stop: true });
        }),
    ),
  );
  return reports.reduce(
    (sum, one) => ({
      // Сколько событий увидели вкладки — это доставка, главное число этапа 7.
      seen: sum.seen + (one.seen ?? 0),
      // ХУДШИЙ, а не сумма и не среднее: один вставший держатель портит
      // замер целиком, а среднее его спрячет (task-091, П-0).
      lagMs: Math.max(sum.lagMs, one.lagMs ?? 0),
      syncs: sum.syncs + one.syncs,
      panels: sum.panels + (one.panels ?? 0),
      queries: sum.queries + one.queries,
      // Волна переподключений (task-093): сколько раз вернулись к потоку,
      // сколько догонов после этого получили отказ, у скольких кончилась сессия.
      reconnects: sum.reconnects + (one.reconnects ?? 0),
      syncFailures: sum.syncFailures + (one.syncFailures ?? 0),
      sessionEnded: sum.sessionEnded + (one.sessionEnded ?? 0),
      refusals: merged(sum.refusals, one.refusals),
    }),
    {
      seen: 0,
      lagMs: 0,
      syncs: 0,
      panels: 0,
      queries: 0,
      reconnects: 0,
      syncFailures: 0,
      sessionEnded: 0,
      refusals: {},
    },
  );
}
