#!/usr/bin/env node

/**
 * Цена ПОТОКА сообщений в живом чате (task-086).
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ ГЕЙТА ЦЕНЫ СОБЫТИЯ. `make event-cost` меряет ОДНО
 * сообщение при N и 2N вкладках — ось «число слушателей». Здесь другая
 * ось: **сколько сообщений идёт подряд**. Она важна потому, что список
 * чатов перечитывается на каждый звонок, и в живом чате на десять реплик
 * подряд приходится десять перечитываний у каждой вкладки.
 *
 * Одним событием эту ось не увидеть вовсе: при одном сообщении разницы
 * между «перечитывать всегда» и «перечитывать не чаще раза в N секунд»
 * нет. Поэтому гейт её и не видел.
 *
 * ЧТО СЧИТАЕМ. Сколько перечитываний панели и сколько запросов к базе
 * приходится на ОДНО сообщение, когда сообщения идут потоком.
 *
 * Это прибор, а не гейт: храповика у него нет. Числа идут в журнал плана
 * руками — вместе с оговоркой, на чём мерили.
 *
 * Запуск: make panel-cost (стек должен быть поднят: make up)
 * Настройки: TABS=40 MESSAGES=10 GAP_MS=300 make panel-cost
 */

import { holdTabs, inviteLink, registerOwner, releaseTabs, request } from "./stand.mjs";

const TABS = Number(process.env.TABS ?? 40);

/** Сколько реплик подряд. Одна — и ось не видна: см. заголовок. */
const MESSAGES = Number(process.env.MESSAGES ?? 10);

/**
 * Пауза между репликами.
 *
 * ⚠️ НЕ НОЛЬ. Мы меряем живой разговор, а не залп: люди пишут с паузами
 * в сотни миллисекунд. При нуле замер мерил бы слипание запросов в сети,
 * а не поведение клиента.
 */
const GAP_MS = Number(process.env.GAP_MS ?? 300);

/** Сколько ждём, пока последние вкладки отреагируют на последнюю реплику. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 5000);

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

const health = await fetch(`${BASE}/health`);
if (!health.ok) {
  console.error("стек не поднят — сначала make up");
  process.exit(1);
}

const owner = await registerOwner();
const token = await inviteLink(owner.cookie, TABS + 2);
const workers = await holdTabs(token, owner.room, TABS);

let write = 0;
for (let n = 0; n < MESSAGES; n++) {
  const sent = await request(`/v1/conversations/${owner.room}/messages`, {
    method: "POST",
    body: { body: `поток ${n}`, clientMsgId: crypto.randomUUID() },
    cookie: owner.cookie,
  });
  if (!sent.ok) throw new Error(`отправка ${n}: ${sent.status}`);
  write += Number(sent.headers.get("x-db-queries") ?? 0);
  await new Promise((resolve) => setTimeout(resolve, GAP_MS));
}

await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
const reaction = await releaseTabs(workers);

const total = write + reaction.queries;
console.log(
  `${TABS} вкладок, ${MESSAGES} реплик подряд с паузой ${GAP_MS} мс ` + `(в одном чате):`,
);
console.log(
  `  запросов к базе всего ${total} = запись ${write} + реакция вкладок ${reaction.queries}`,
);
console.log(`  перечитываний панели ${reaction.panels}, догонов ${reaction.syncs}`);
console.log(
  `  НА ОДНО СООБЩЕНИЕ: ${(total / MESSAGES).toFixed(1)} запросов, ` +
    `${(reaction.panels / MESSAGES / TABS).toFixed(2)} перечитываний панели на вкладку`,
);
