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
  return host === "localhost" || host === "127.0.0.1";
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

  const { latencies, failures, seconds, total } = await load(owner.room, senders);

  // Даём событиям доехать: раздача идёт после ответа на отправку.
  await new Promise((r) => setTimeout(r, 3000));
  const reaction = await releaseTabs(workers);

  report({ latencies, failures, total, seconds, tabs, reaction });
}

/**
 * Итог числами.
 *
 * ⚠️ ДОЛИ, А НЕ СРЕДНЕЕ, и оговорка рядом с числами, а не в чьей-то
 * голове. Замер с одной машины систематически приукрашивает, и число
 * без этой строки однажды процитируют как обещание клиенту.
 */
function report({ latencies, failures, total, seconds, tabs, reaction }) {
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
  console.log(`память процесса:   ${Math.round(process.memoryUsage().rss / 1e6)} МБ у ИЗМЕРИТЕЛЯ`);

  // ⚠️ ОТКАЗЫ ПО ЧАСТОТЕ — ПОСЛЕДНЯЯ СТРОКА ОТЧЁТА, И ОНА ОБЯЗАТЕЛЬНА.
  // Общий порог у нас 5000 в минуту на АДРЕС, а генератор приходит
  // с одного. Числа выше без этой строки недоказаны (task-091, П-7).
  // ⚠️ ДВА СТОРОЖА ИДУТ ВМЕСТЕ И ПЕРЕД ВЫВОДАМИ. Первый ловит, что мы
  // упёрлись в свой порог частоты; второй — что упёрлись в сам прибор.
  // Оба отвечают на один вопрос: про сервер ли числа выше (task-091).
  reportRefusals(reaction.refusals);
  reportLag(reaction.lagMs);

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
  console.error("\nзамер не состоялся:", error.message);
  process.exit(1);
});
