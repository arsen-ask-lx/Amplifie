#!/usr/bin/env node
/**
 * Нагрузочный замер (Р-026, task-019).
 *
 * Меряет ровно три числа, которыми записана цель продукта:
 *   · сколько вкладок держится на потоке живых обновлений;
 *   · сколько сообщений в секунду проходит;
 *   · за сколько сообщение доезжает до ЧУЖОЙ вкладки.
 *
 * Третье в цели не записано, и это было упущение: «держим 400 вкладок»
 * ничего не значит, если доставка занимает десять секунд.
 *
 * ⚠️ СВОЙ, А НЕ ГОТОВЫЙ ИЗМЕРИТЕЛЬ, И ЭТО ОБОСНОВАНО В Р-026. Готовые
 * меряют запросы к ручкам; наше узкое место — раздача событий, где ОДНО
 * сообщение будит все открытые потоки, и каждый идёт в базу (Д-3, Д-4).
 *
 * ⚠️ ИЗМЕРИТЕЛЬ НЕ ПРОВЕРЕН НИЧЕМ, КРОМЕ СЕБЯ. Поэтому первым делом он
 * меряет заведомо известное — одну вкладку и одно сообщение, где задержку
 * видно глазами рядом в браузере. Числа, которые не сошлись с глазами,
 * в реестр не идут.
 *
 * Запуск: make load (стек должен быть поднят: make up)
 */

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

/**
 * Настройки замера.
 *
 * ⚠️ ИМЕНА ЛАТИНИЦЕЙ, ХОТЯ ВЕСЬ ОСТАЛЬНОЙ КОД ПО-РУССКИ. Переменную
 * окружения с кириллицей оболочка не примет: `ВКЛАДОК=3 node ...` падает
 * с «command not found». Проверено, а не предположено.
 */
const TABS = Number(process.env.TABS ?? 400);
const RATE = Number(process.env.RATE ?? 10);
const SECONDS = Number(process.env.SECONDS ?? 20);

/**
 * ⚠️ ОТПРАВИТЕЛЕЙ НЕСКОЛЬКО, И ЭТО НЕ УКРАШЕНИЕ. Порог отправки — 30
 * реплик в минуту НА ЧЕЛОВЕКА (Р-025). Десять в секунду от одного имени
 * упрутся в него через три секунды, и мы измерили бы свой же порог,
 * а не сервер.
 */
const SENDERS = Math.max(2, Math.ceil((RATE * SECONDS) / 25));

/**
 * Сколько вкладок открывает один человек.
 *
 * ⚠️ ВОСЕМЬ, А НЕ ОДНА. Порог подключений к потоку — десять в минуту
 * на человека (Р-025), и восемь оставляет запас. Заодно это ближе
 * к жизни: одна и та же почта открыта и на работе, и дома.
 *
 * И это единственный способ померить восемьсот вкладок, не уперевшись
 * в НАШ порог входа по приглашению: восемьсот входов в минуту он
 * не пропустит и правильно сделает. Измеритель об этом сказал сам —
 * ровно то, ради чего в нём заведена отдельная ошибка «это мой порог».
 */
const TABS_PER_PERSON = 8;

const password = "ochen-dlinnyi-parol-dlya-zamera";

function emailFor(tag) {
  return `load-${Date.now()}-${tag}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookieOf(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((one) => one.startsWith("amplifie_session="));
  const value = header ? header.split(";")[0] : null;
  if (!value) throw new Error("сервер не выдал печеньку сессии");
  return value;
}

/** Завести владельца со своим пространством. */
async function registerOwner() {
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
  const rooms = await request("/v1/conversations", { cookie });
  const list = await rooms.json();
  const room = list.items?.[0]?.id;
  if (!room) throw new Error("у нового пространства нет канала");
  return { cookie, room };
}

/** Одна ссылка на всех: столько же, сколько сделал бы человек. */
async function inviteLink(cookie, uses) {
  const response = await request("/v1/invites", {
    method: "POST",
    body: { maxUses: Math.min(500, uses + 5) },
    cookie,
  });
  if (!response.ok) throw new Error(`приглашение: ${response.status}`);
  return (await response.json()).token;
}

async function joined(token, tag) {
  const response = await request("/v1/auth/join", {
    method: "POST",
    body: { token, email: emailFor(tag), password: password, displayName: `Гость ${tag}` },
  });
  if (response.status === 429) throw new OwnRateLimitError("вход по приглашению");
  if (!response.ok) throw new Error(`вход по ссылке: ${response.status}`);
  return cookieOf(response);
}

/** Упёрлись в СВОЙ порог частоты, а не в предел сервера (Р-025). */
class OwnRateLimitError extends Error {}

/**
 * Открытая вкладка: держит поток и запоминает, когда увидела событие.
 *
 * ⚠️ ЧИТАЕМ ПОТОК ПОБАЙТНО, А НЕ ЖДЁМ КОНЦА. Поток не кончается никогда;
 * `response.text()` на нём висел бы вечно, и замер молча показал бы ноль
 * событий при живом сервере.
 */
async function openTab(cookie, seen) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status === 429) throw new OwnRateLimitError("подключение к потоку");
  if (!response.ok || !response.body) throw new Error(`поток: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        // Событие приехало — только время и важно. Что именно приехало,
        // проверяют приёмочные, а не замер.
        if (decoder.decode(value, { stream: true }).includes("data:")) {
          seen.push(Date.now());
        }
      }
    } catch {
      // Поток закрыли — это конец замера, а не поломка.
    }
  })();
  return controller;
}

/** Доли, а не среднее: среднее прячет как раз то, ради чего меряем. */
function percentiles(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), worst: sorted.at(-1) };
}

function ms(value) {
  return value === undefined ? "—" : `${value} мс`;
}

/**
 * Погонять нагрузку: слать с заданным темпом и записывать, за сколько
 * сервер ответил.
 *
 * ⚠️ ТЕМП ДЕРЖИТСЯ ПО ЧАСАМ, А НЕ ПАУЗОЙ МЕЖДУ ЗАПРОСАМИ. Пауза
 * складывалась бы с временем ответа, и десять в секунду превращались
 * бы в семь — мы измерили бы собственную арифметику.
 */
async function load(room, senders, seen) {
  const latencies = [];
  const failures = { rateLimit: 0, other: 0 };
  const total = RATE * SECONDS;
  const step = 1000 / RATE;
  const startedAt = Date.now();
  seen.length = 0;

  const sent = [];
  for (let n = 0; n < total; n++) {
    const pause = startedAt + n * step - Date.now();
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));

    const cookie = senders[n % senders.length];
    const sentAt = Date.now();
    sent.push(
      request(`/v1/conversations/${room}/messages`, {
        method: "POST",
        body: { body: `замер ${n}`, clientMsgId: crypto.randomUUID() },
        cookie,
      })
        .then((response) => {
          if (response.status === 429) failures.rateLimit += 1;
          else if (!response.ok) failures.other += 1;
          else latencies.push(Date.now() - sentAt);
        })
        .catch(() => {
          failures.other += 1;
        }),
    );
  }
  await Promise.all(sent);
  return { latencies, failures, seconds: (Date.now() - startedAt) / 1000, total };
}

async function run() {
  console.log(`стенд: ${BASE}`);
  console.log(`цель: ${TABS} вкладок · ${RATE} сообщений в секунду · ${SECONDS} с\n`);

  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, TABS + SENDERS);

  process.stdout.write(`открываю вкладки: 0/${TABS}`);
  const seen = [];
  const held = [];
  for (let opened = 0; opened < TABS; ) {
    const cookie = await joined(token, `tab${opened}`);
    // Несколько вкладок на одну сессию — см. ВКЛАДОК_НА_ЧЕЛОВЕКА выше.
    for (let n = 0; n < TABS_PER_PERSON && opened < TABS; n++, opened++) {
      held.push(await openTab(cookie, seen));
      if (opened % 50 === 0)
        process.stdout.write(`
открываю вкладки: ${opened}/${TABS}`);
    }
  }
  console.log(`\rоткрыто вкладок: ${held.length}/${TABS}          `);

  const senders = [];
  for (let n = 0; n < SENDERS; n++) {
    senders.push(await joined(token, `send${n}`));
  }

  const { latencies, failures, seconds, total } = await load(owner.room, senders, seen);

  // Даём событиям доехать: раздача идёт после ответа на отправку.
  await new Promise((r) => setTimeout(r, 3000));
  for (const controller of held) controller.abort();

  report({
    latencies,
    failures,
    total,
    seconds,
    tabs: held.length,
    events: seen.length,
  });
}

/**
 * Итог числами.
 *
 * ⚠️ ДОЛИ, А НЕ СРЕДНЕЕ, и оговорка рядом с числами, а не в чьей-то
 * голове. Замер с одной машины систематически приукрашивает, и число
 * без этой строки однажды процитируют как обещание клиенту.
 */
function report({ latencies, failures, total, seconds, tabs, events }) {
  const expected = latencies.length * tabs;
  const stats = percentiles(latencies);

  console.log("\n── что получилось ─────────────────────────────────");
  console.log(`отправлено:        ${latencies.length} из ${total} за ${seconds.toFixed(1)} с`);
  console.log(
    `отказов по порогу: ${failures.rateLimit}${failures.rateLimit ? "  ⚠️ мерили СВОЙ порог" : ""}`,
  );
  console.log(`прочих отказов:    ${failures.other}`);
  console.log(
    `ответ на отправку: половина ${ms(stats?.p50)} · 0.9 ${ms(stats?.p90)} · ` +
      `0.99 ${ms(stats?.p99)} · худший ${ms(stats?.worst)}`,
  );
  console.log(
    `событий в потоках: ${events} из ${expected} ожидаемых ` +
      `(${expected ? Math.round((events / expected) * 100) : 0}%)`,
  );
  console.log(`память процесса:   ${Math.round(process.memoryUsage().rss / 1e6)} МБ у ИЗМЕРИТЕЛЯ`);
  console.log("\n⚠️ Оговорка: замер с ОДНОЙ машины. Сто вкладок отсюда и сто человек");
  console.log("   из разных сетей — не одно и то же; числа получаются оптимистичными.");
}

run().catch((error) => {
  if (error instanceof OwnRateLimitError) {
    console.error(`\n⚠️ упёрлись в СВОЙ порог частоты (${error.message}) — это не предел сервера.`);
    console.error("   Пороги живут в Р-025; для замера их поднимают, а не обходят.");
    process.exit(2);
  }
  console.error("\nзамер не состоялся:", error.message);
  process.exit(1);
});
