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
const ВКЛАДОК = Number(process.env.TABS ?? 400);
const В_СЕКУНДУ = Number(process.env.RATE ?? 10);
const СЕКУНД = Number(process.env.SECONDS ?? 20);

/**
 * ⚠️ ОТПРАВИТЕЛЕЙ НЕСКОЛЬКО, И ЭТО НЕ УКРАШЕНИЕ. Порог отправки — 30
 * реплик в минуту НА ЧЕЛОВЕКА (Р-025). Десять в секунду от одного имени
 * упрутся в него через три секунды, и мы измерили бы свой же порог,
 * а не сервер.
 */
const ОТПРАВИТЕЛЕЙ = Math.max(2, Math.ceil((В_СЕКУНДУ * СЕКУНД) / 25));

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
const ВКЛАДОК_НА_ЧЕЛОВЕКА = 8;

const пароль = "ochen-dlinnyi-parol-dlya-zamera";

function адрес(tag) {
  return `load-${Date.now()}-${tag}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function запрос(path, { method = "GET", body, cookie } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function печенька(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((one) => one.startsWith("amplifie_session="));
  const value = header ? header.split(";")[0] : null;
  if (!value) throw new Error("сервер не выдал печеньку сессии");
  return value;
}

/** Завести владельца со своим пространством. */
async function владелец() {
  const response = await запрос("/v1/auth/register", {
    method: "POST",
    body: {
      email: адрес("owner"),
      password: пароль,
      displayName: "Замер",
      workspaceName: `Замер ${new Date().toISOString().slice(11, 19)}`,
    },
  });
  if (!response.ok) throw new Error(`регистрация владельца: ${response.status}`);
  const cookie = печенька(response);
  const rooms = await запрос("/v1/conversations", { cookie });
  const list = await rooms.json();
  const room = list.items?.[0]?.id;
  if (!room) throw new Error("у нового пространства нет канала");
  return { cookie, room };
}

/** Одна ссылка на всех: столько же, сколько сделал бы человек. */
async function ссылка(cookie, наСколько) {
  const response = await запрос("/v1/invites", {
    method: "POST",
    body: { maxUses: Math.min(500, наСколько + 5) },
    cookie,
  });
  if (!response.ok) throw new Error(`приглашение: ${response.status}`);
  return (await response.json()).token;
}

async function вошедший(token, tag) {
  const response = await запрос("/v1/auth/join", {
    method: "POST",
    body: { token, email: адрес(tag), password: пароль, displayName: `Гость ${tag}` },
  });
  if (response.status === 429) throw new ПорогНашЖе("вход по приглашению");
  if (!response.ok) throw new Error(`вход по ссылке: ${response.status}`);
  return печенька(response);
}

/** Упёрлись в СВОЙ порог частоты, а не в предел сервера (Р-025). */
class ПорогНашЖе extends Error {}

/**
 * Открытая вкладка: держит поток и запоминает, когда увидела событие.
 *
 * ⚠️ ЧИТАЕМ ПОТОК ПОБАЙТНО, А НЕ ЖДЁМ КОНЦА. Поток не кончается никогда;
 * `response.text()` на нём висел бы вечно, и замер молча показал бы ноль
 * событий при живом сервере.
 */
async function вкладка(cookie, увидено) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status === 429) throw new ПорогНашЖе("подключение к потоку");
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
          увидено.push(Date.now());
        }
      }
    } catch {
      // Поток закрыли — это конец замера, а не поломка.
    }
  })();
  return controller;
}

/** Доли, а не среднее: среднее прячет как раз то, ради чего меряем. */
function доли(числа) {
  if (числа.length === 0) return null;
  const ряд = [...числа].sort((a, b) => a - b);
  const at = (доля) => ряд[Math.min(ряд.length - 1, Math.floor(доля * ряд.length))];
  return { половина: at(0.5), девять: at(0.9), почтиВсе: at(0.99), худшее: ряд.at(-1) };
}

function мс(значение) {
  return значение === undefined ? "—" : `${значение} мс`;
}

/**
 * Погонять нагрузку: слать с заданным темпом и записывать, за сколько
 * сервер ответил.
 *
 * ⚠️ ТЕМП ДЕРЖИТСЯ ПО ЧАСАМ, А НЕ ПАУЗОЙ МЕЖДУ ЗАПРОСАМИ. Пауза
 * складывалась бы с временем ответа, и десять в секунду превращались
 * бы в семь — мы измерили бы собственную арифметику.
 */
async function нагрузка(room, отправители, увидено) {
  const задержки = [];
  const отказы = { порог: 0, прочие: 0 };
  const всего = В_СЕКУНДУ * СЕКУНД;
  const шаг = 1000 / В_СЕКУНДУ;
  const начало = Date.now();
  увидено.length = 0;

  const посланное = [];
  for (let n = 0; n < всего; n++) {
    const пауза = начало + n * шаг - Date.now();
    if (пауза > 0) await new Promise((r) => setTimeout(r, пауза));

    const cookie = отправители[n % отправители.length];
    const ушло = Date.now();
    посланное.push(
      запрос(`/v1/conversations/${room}/messages`, {
        method: "POST",
        body: { body: `замер ${n}`, clientMsgId: crypto.randomUUID() },
        cookie,
      })
        .then((response) => {
          if (response.status === 429) отказы.порог += 1;
          else if (!response.ok) отказы.прочие += 1;
          else задержки.push(Date.now() - ушло);
        })
        .catch(() => {
          отказы.прочие += 1;
        }),
    );
  }
  await Promise.all(посланное);
  return { задержки, отказы, шло: (Date.now() - начало) / 1000, всего };
}

async function замер() {
  console.log(`стенд: ${BASE}`);
  console.log(`цель: ${ВКЛАДОК} вкладок · ${В_СЕКУНДУ} сообщений в секунду · ${СЕКУНД} с\n`);

  const хозяин = await владелец();
  const token = await ссылка(хозяин.cookie, ВКЛАДОК + ОТПРАВИТЕЛЕЙ);

  process.stdout.write(`открываю вкладки: 0/${ВКЛАДОК}`);
  const увидено = [];
  const держим = [];
  for (let открыто = 0; открыто < ВКЛАДОК; ) {
    const cookie = await вошедший(token, `tab${открыто}`);
    // Несколько вкладок на одну сессию — см. ВКЛАДОК_НА_ЧЕЛОВЕКА выше.
    for (let n = 0; n < ВКЛАДОК_НА_ЧЕЛОВЕКА && открыто < ВКЛАДОК; n++, открыто++) {
      держим.push(await вкладка(cookie, увидено));
      if (открыто % 50 === 0)
        process.stdout.write(`
открываю вкладки: ${открыто}/${ВКЛАДОК}`);
    }
  }
  console.log(`\rоткрыто вкладок: ${держим.length}/${ВКЛАДОК}          `);

  const отправители = [];
  for (let n = 0; n < ОТПРАВИТЕЛЕЙ; n++) {
    отправители.push(await вошедший(token, `send${n}`));
  }

  const { задержки, отказы, шло, всего } = await нагрузка(хозяин.room, отправители, увидено);

  // Даём событиям доехать: раздача идёт после ответа на отправку.
  await new Promise((r) => setTimeout(r, 3000));
  for (const controller of держим) controller.abort();

  печать({
    задержки,
    отказы,
    всего,
    шло,
    вкладок: держим.length,
    событий: увидено.length,
  });
}

/**
 * Итог числами.
 *
 * ⚠️ ДОЛИ, А НЕ СРЕДНЕЕ, и оговорка рядом с числами, а не в чьей-то
 * голове. Замер с одной машины систематически приукрашивает, и число
 * без этой строки однажды процитируют как обещание клиенту.
 */
function печать({ задержки, отказы, всего, шло, вкладок, событий }) {
  const ожидали = задержки.length * вкладок;
  const ответ = доли(задержки);

  console.log("\n── что получилось ─────────────────────────────────");
  console.log(`отправлено:        ${задержки.length} из ${всего} за ${шло.toFixed(1)} с`);
  console.log(`отказов по порогу: ${отказы.порог}${отказы.порог ? "  ⚠️ мерили СВОЙ порог" : ""}`);
  console.log(`прочих отказов:    ${отказы.прочие}`);
  console.log(
    `ответ на отправку: половина ${мс(ответ?.половина)} · 0.9 ${мс(ответ?.девять)} · ` +
      `0.99 ${мс(ответ?.почтиВсе)} · худший ${мс(ответ?.худшее)}`,
  );
  console.log(
    `событий в потоках: ${событий} из ${ожидали} ожидаемых ` +
      `(${ожидали ? Math.round((событий / ожидали) * 100) : 0}%)`,
  );
  console.log(`память процесса:   ${Math.round(process.memoryUsage().rss / 1e6)} МБ у ИЗМЕРИТЕЛЯ`);
  console.log("\n⚠️ Оговорка: замер с ОДНОЙ машины. Сто вкладок отсюда и сто человек");
  console.log("   из разных сетей — не одно и то же; числа получаются оптимистичными.");
}

замер().catch((error) => {
  if (error instanceof ПорогНашЖе) {
    console.error(`\n⚠️ упёрлись в СВОЙ порог частоты (${error.message}) — это не предел сервера.`);
    console.error("   Пороги живут в Р-025; для замера их поднимают, а не обходят.");
    process.exit(2);
  }
  console.error("\nзамер не состоялся:", error.message);
  process.exit(1);
});
