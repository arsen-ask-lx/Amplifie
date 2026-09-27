#!/usr/bin/env node
/**
 * Нагрузочный замер (Р-026, task-019).
 *
 * Меряет:
 *   · сколько вкладок держится на потоке живых обновлений;
 *   · сколько сообщений в секунду проходит и за сколько сервер ОТВЕЧАЕТ
 *     на отправку;
 *   · какая доля событий дошла до вкладок.
 *
 * ⚠️ ВРЕМЯ ДОСТАВКИ ДО ЧУЖОЙ ВКЛАДКИ ЭТОТ ПРИБОР НЕ МЕРИТ. Раньше здесь
 * было написано обратное: держатели собирают время прихода событий, но
 * отдают родителю только их число, и с отправкой оно не связано. Время
 * доставки меряет k6 — `make k6-sse` (task-122, Р-051); числа «задержки»
 * в Р-038 — это ответ на отправку.
 *
 * `SYNC=0` — вкладки только слушают, без догона и панели: режим сверки
 * с k6 на одних условиях. По умолчанию вкладки ведут себя как клиент.
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
 * ⚠️ ВЫШЕ ТЫСЯЧИ ВКЛАДОК ЗАМЕР ДЕЛАЕТСЯ ИЗНУТРИ СЕТИ СТЕНДА, А НЕ С ХОЗЯИНА.
 *
 * Проброс портов Docker на Windows обрывает соединения примерно после
 * 1700 открытых труб: замер падает с `fetch failed (ECONNRESET)`, и это
 * выглядит отказом СЕРВЕРА. Сервер при этом здоров — контрольный прогон
 * к `api:3000` напрямую отдал 2000 вкладок и 100 000 событий из 100 000.
 *
 * Это второй раз, когда проброс портов портит замер: в task-089 он сам
 * вычитывал данные и показал ноль обратного давления. Правило записано
 * здесь, а не в чьей-то памяти:
 *
 *   docker run --rm --network amplifie_default -v "E:/Amplifie:/work:ro" -w /work \
 *     -e AMPLIFIE_BASE_URL=http://caddy:80 -e TABS=3000 \
 *     node:26-bookworm-slim node tools/load/measure.mjs
 *
 * Через `caddy:80`, а не `api:3000`: так идёт человек, и так же ходит k6 при
 * сверке (task-122). Мимо Caddy бек верит `X-Forwarded-For` соседу по сети.
 *
 * Цена такого прогона названа честно: генератор делит с сервером три ядра
 * машины Docker, и обстановку изнутри прибор назвать не может — в контейнере
 * нет `docker`. Сторож собственного лага работает и там.
 *
 * Запуск: make load (стек должен быть поднят: make up)
 */

import { reportStrangers, watchStrangers } from "./conditions.mjs";
import {
  BASE,
  holdTabs,
  inviteLink,
  joined,
  OwnRateLimitError,
  registerOwner,
  releaseTabs,
  reportLag,
  reportRefusals,
  request,
} from "./stand.mjs";

const TABS = Number(process.env.TABS ?? 400);

/**
 * Как ведут себя вкладки.
 *
 * `same` (по умолчанию) — все смотрят тот чат, куда идут сообщения. Это
 * ХУДШИЙ случай и он же сравним с прежними числами: догон законен у всех.
 * `other` — смотрят другой чат, то есть обычная жизнь пяти тысяч человек
 * с разными открытыми чатами. `any` — поведение клиента до task-067:
 * догоняет на любой звонок.
 */
const WATCHING = process.env.WATCHING ?? "same";

/**
 * Сколько вкладок на один процесс-держатель.
 *
 * ⚠️ СОТНЯ, И ЭТО НЕ ВКУС. Пока вкладки и отправка жили в одном процессе,
 * замер мерил СЕБЯ: 400 вкладок давали 4,8 с в середине даже когда вкладки
 * не делали ни одного запроса, чего на сервере быть не могло. Держатели —
 * отдельные процессы, родитель только отправляет и считает время.
 */
const TABS_PER_WORKER = Number(process.env.TABS_PER_WORKER ?? 100);
const RATE = Number(process.env.RATE ?? 10);
const SECONDS = Number(process.env.SECONDS ?? 20);

/**
 * ⚠️ ОТПРАВИТЕЛЕЙ НЕСКОЛЬКО, И ЭТО НЕ УКРАШЕНИЕ. Порог отправки — 30
 * реплик в минуту НА ЧЕЛОВЕКА (Р-025). Десять в секунду от одного имени
 * упрутся в него через три секунды, и мы измерили бы свой же порог,
 * а не сервер.
 */
const SENDERS = Math.max(2, Math.ceil((RATE * SECONDS) / 25));

/** Доли, а не среднее: среднее прячет как раз то, ради чего меряем. */
function percentiles(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), worst: sorted.at(-1) };
}

/** Генератор и сервер на одной машине — тогда числа оптимистичны. */
function alone() {
  const host = new URL(BASE).hostname;
  // `caddy` и `api` — соседи по сети стенда, то есть та же машина Docker.
  // Без них прогон изнутри сети (task-089) печатал «разные машины».
  return ["localhost", "127.0.0.1", "caddy", "api"].includes(host);
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
async function load(room, senders) {
  const latencies = [];
  const failures = { rateLimit: 0, other: 0 };
  const total = RATE * SECONDS;
  const step = 1000 / RATE;
  const startedAt = Date.now();

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
  console.log(
    `цель: ${TABS} вкладок · ${RATE} сообщений в секунду · ${SECONDS} с · смотрят: ${WATCHING}`,
  );

  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, TABS + SENDERS);

  // Соседний чат — тот, который вкладки «смотрят» в обычной жизни: у людей
  // открыты разные разговоры, и сообщение в одном не касается остальных.
  const aside = await request("/v1/conversations", {
    method: "POST",
    body: { title: "Соседний чат", visibility: "workspace" },
    cookie: owner.cookie,
  });
  if (!aside.ok) throw new Error(`соседний чат: ${aside.status}`);
  const other = (await aside.json()).id;
  const watching = WATCHING === "any" ? null : WATCHING === "other" ? other : owner.room;

  /**
   * ⚠️ ДЕРЖАТЕЛИ БЕРУТСЯ ИЗ `stand.mjs`, А НЕ ЗАВОДЯТСЯ ЗДЕСЬ.
   *
   * Здесь лежала вторая копия `holdTabs`/`releaseTabs`, и она уже разошлась
   * с первой: собирала у держателей только число увиденных событий, а всё
   * остальное, чем они отчитываются, молча выбрасывала. Вместе с этим
   * терялись бы и отказы по частоте — то самое число, без которого замер
   * на 3000 вкладках рассказал бы про НАШ порог вместо предела сервера
   * (task-091, П-7).
   *
   * Ждём, пока открыты ВСЕ вкладки: отправка, начатая раньше, измерила бы
   * нагрузку не на том числе слушателей, которое потом напечатано в отчёте.
   */
  const workers = await holdTabs(token, watching, TABS, TABS_PER_WORKER);
  const tabs = workers.reduce((sum, one) => sum + one.tabs, 0);
  console.log(`открыто вкладок: ${tabs} в ${workers.length} процессах`);

  const senders = [];
  for (let n = 0; n < SENDERS; n++) {
    senders.push(await joined(token, `send${n}`));
  }

  // Свидетель обстановки заводится ровно на время нагрузки: чужие соседи
  // не гасятся (решение владельца), значит надо знать, что они делали.
  const strangers = watchStrangers();
  const { latencies, failures, seconds, total } = await load(owner.room, senders);

  // Даём событиям доехать: раздача идёт после ответа на отправку.
  await new Promise((r) => setTimeout(r, 3000));
  const reaction = await releaseTabs(workers);
  const around = await strangers.stop();

  report({ latencies, failures, total, seconds, tabs, reaction, around });
}

/**
 * Итог числами.
 *
 * ⚠️ ДОЛИ, А НЕ СРЕДНЕЕ, и оговорка рядом с числами, а не в чьей-то
 * голове. Замер с одной машины систематически приукрашивает, и число
 * без этой строки однажды процитируют как обещание клиенту.
 */
function report({ latencies, failures, total, seconds, tabs, reaction, around }) {
  const expected = latencies.length * tabs;
  const stats = percentiles(latencies);
  const events = reaction.seen;

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
  /**
   * ⚠️ ЧЕМ ВКЛАДКИ ЗАНЯЛИ СЕРВЕР — БЕЗ ЭТОЙ СТРОКИ ОТЧЁТ НЕ ОБЪЯСНЯЕТ ХВОСТ.
   *
   * Время ответа на отправку — это следствие; причина в том, что делают
   * в ту же секунду сто вкладок. Числа собирают сами держатели по заголовку
   * `x-db-queries`, то есть это цена НА СЕРВЕРЕ, а не догадка.
   */
  console.log(
    `вкладки в ответ:   догонов ${reaction.syncs}, перечитываний панели ${reaction.panels}, ` +
      `запросов к базе ${reaction.queries}`,
  );
  console.log(`память процесса:   ${Math.round(process.memoryUsage().rss / 1e6)} МБ у ИЗМЕРИТЕЛЯ`);

  // ⚠️ ОТКАЗЫ ПО ЧАСТОТЕ — ПОСЛЕДНЯЯ СТРОКА ОТЧЁТА, И ОНА ОБЯЗАТЕЛЬНА.
  // Общий порог у нас 5000 в минуту на АДРЕС, а генератор приходит
  // с одного. Числа выше без этой строки недоказаны (task-091, П-7).
  // ⚠️ ТРИ СТОРОЖА ИДУТ ВМЕСТЕ И ПЕРЕД ВЫВОДАМИ, и все отвечают на один
  // вопрос: про сервер ли числа выше (task-091). Первый ловит, что мы
  // упёрлись в свой порог частоты; второй — что упёрлись в сам прибор;
  // третий — что рядом шумел чужой проект, который мы не гасим.
  reportRefusals(reaction.refusals);
  reportLag(reaction.lagMs);
  reportStrangers(around);

  /**
   * Строка для сверки с k6 (`make k6-compare`, task-122): разбирать русский
   * отчёт выше хрупко, одна правка строки сломала бы сверку молча. Доля —
   * та же формула, что у k6: событий ÷ (успешных отправок × открытых вкладок).
   * Совпадают, пока в пространстве нет других звонков: сейчас в режиме
   * `SYNC=0` их нет, а появятся — сверка покраснеет, а не соврёт молча.
   * Режим и переподключения едут в строке: без них сверка не знает, шёл ли
   * прибор на тех же условиях, что k6 (тот не переподключается).
   */
  const refused = Object.values(reaction.refusals ?? {}).reduce((sum, one) => sum + one, 0);
  const result = {
    tool: "свой",
    tabs: tabs,
    sent: latencies.length,
    delivered: events,
    share: expected ? events / expected : 0,
    sendMs: stats && { p50: stats.p50, p90: stats.p90, p99: stats.p99 },
    ownLimit: failures.rateLimit + refused,
    failed: failures.other,
    sync: process.env.SYNC !== "0",
    reconnects: reaction.reconnects,
  };
  console.log(`\nИТОГ-JSON ${JSON.stringify(result)}`);

  /**
   * Оговорка про одну машину — только когда машина одна.
   *
   * Раньше она печаталась всегда. Стоило бы запустить генератор с другой
   * машины (этап 7), и отчёт продолжил бы извиняться за то, чего уже нет,
   * — а такую строку однажды процитируют вместе с числами.
   */
  if (alone()) {
    console.log("\n⚠️ Оговорка: замер с ОДНОЙ машины. Сто вкладок отсюда и сто человек");
    console.log("   из разных сетей — не одно и то же; числа получаются оптимистичными.");
  } else {
    console.log(`
⚠️ Условия: генератор и сервер РАЗНЫЕ машины, сервер — ${BASE}.`);
    console.log("   Что между ними за сеть, числа не знают: назови это в журнале плана.");
  }
}

run().catch((error) => {
  if (error instanceof OwnRateLimitError) {
    console.error(`\n⚠️ упёрлись в СВОЙ порог частоты (${error.message}) — это не предел сервера.`);
    console.error("   Пороги живут в Р-025; для замера их поднимают, а не обходят.");
    process.exit(2);
  }
  /**
   * ⚠️ ПРИЧИНУ НЕ ГЛОТАЕМ. У `fetch` сообщение всегда одно и то же —
   * «fetch failed», — а настоящая причина лежит в `cause`: отказано
   * в соединении, кончились порты, оборвал сервер. Без неё отказ прибора
   * неотличим от отказа продукта, и я потерял на этом целый заход.
   */
  console.error(`\nзамер не состоялся: ${error.message}`);
  const why = error?.cause;
  if (why) console.error("   причина:", why.code ?? why.message ?? String(why));
  if (error?.stack) {
    console.error(
      error.stack.split(String.fromCharCode(10)).slice(1, 4).join(String.fromCharCode(10)),
    );
  }
  process.exit(1);
});
