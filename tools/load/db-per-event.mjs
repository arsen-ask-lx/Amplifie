#!/usr/bin/env node

/**
 * Цена одного события: сколько раз база отвечает на ОДНО отправленное
 * сообщение при N подключённых вкладках (Д-3, task-067).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЗАМЕР. `make load` меряет темп и задержку — и по ним
 * видно, что при 800 вкладках события теряются, но НЕ видно почему.
 * Причина названа в реестре долга словами: звонок пустой, поэтому каждая
 * вкладка идёт в `/v1/sync`, а тот идёт в Postgres. Слова — не число.
 * Здесь появляется число: ↑N означает «цена растёт вместе с числом
 * слушателей», единицы означают «не растёт».
 *
 * ЧЕМ МЕРЯЕМ. `pg_stat_database.xact_commit` — счётчик зафиксированных
 * транзакций у самой базы.
 *
 * ⚠️ ЭТО ТРАНЗАКЦИИ, А НЕ ОПЕРАТОРЫ, и разница названа, а не спрятана.
 * Оператор вне транзакции — сам себе транзакция, поэтому для дороги
 * чтения (`currentSeq`, `listMessagesAfter`, проверка сессии) счёт идёт
 * один к одному. Но мутация, завёрнутая в `change()`, — это ОДНА
 * транзакция на несколько операторов. Значит число занижает цену записи
 * и точно показывает цену раздачи. Нам нужна вторая.
 *
 * ⚠️ СВОИ ЖЕ ЗАПРОСЫ ТОЖЕ СЧИТАЮТСЯ. Каждый опрос счётчика — одна
 * транзакция. Поэтому рядом с рабочим окном меряется ТИХОЕ окно той же
 * длины: сколько база коммитит, когда мы ничего не отправляли. Разница
 * между окнами и есть цена события, а не сырая дельта.
 *
 * Запуск: make db-per-event (стек должен быть поднят: make up)
 * Настройки: TABS=200 make db-per-event
 */

import { wait, windowOf } from "./pg-counter.mjs";
import { inviteLink, OwnRateLimitError, openTabs, registerOwner, request } from "./stand.mjs";

/**
 * Что именно меряем.
 *
 * `WATCHING=other` (по умолчанию) — вкладки смотрят ДРУГОЙ разговор, чем тот,
 * куда пришло сообщение. Это главный случай жизни: у пяти тысяч человек
 * открыты разные чаты, и звонок с адресом обязан не поднимать никого лишнего.
 *
 * `WATCHING=same` — все вкладки смотрят тот самый разговор. Тогда догон
 * законен, и число показывает цену честной работы, а не стада.
 *
 * `WATCHING=any` — поведение клиента ДО адреса в звонке: догоняет на любой
 * звонок. Им получено красное число 209 транзакций при ста вкладках.
 */
const WATCHING = process.env.WATCHING ?? "other";

const TABS = Number(process.env.TABS ?? 100);

const WINDOW_MS = Number(process.env.WINDOW_MS ?? 10_000);

/** Окно наблюдения общей меркой: см. pg-counter.mjs. */
async function window(work) {
  return windowOf(work, WINDOW_MS);
}

async function run() {
  console.log(`цель: ${TABS} вкладок, одно сообщение, вкладки смотрят: ${WATCHING}\n`);

  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, TABS + 2);
  const sender = owner.cookie;

  // Второй разговор — тот, который вкладки «смотрят», когда мерим главный
  // случай. Виден всем в пространстве: закрытый исказил бы замер тем, что
  // звонок о нём и так не дошёл бы.
  const aside = await request("/v1/conversations", {
    method: "POST",
    body: { title: "Соседний чат", visibility: "workspace" },
    cookie: owner.cookie,
  });
  if (!aside.ok) throw new Error(`соседний чат: ${aside.status}`);
  const other = (await aside.json()).id;

  const watching = WATCHING === "any" ? null : WATCHING === "same" ? owner.room : other;

  const seen = [];
  const held = await openTabs(
    token,
    TABS,
    seen,
    (opened, total) => process.stdout.write(`\rоткрываю вкладки: ${opened}/${total}`),
    { watching },
  );
  console.log(`\rоткрыто вкладок: ${held.length}                    `);

  // ⚠️ ДАЁМ СТЕНДУ УСПОКОИТЬСЯ ПЕРЕД ТИХИМ ОКНОМ. Открытие сотни вкладок
  // само делает запросы, и первый замер ловил их хвост: фон выходил больше
  // рабочего окна, а «цена» — отрицательной. Число, которое бывает
  // отрицательным, неверно, а не «почти верно».
  await wait(WINDOW_MS);

  // Тихое окно: в него попадает биение потока и наши же опросы счётчика —
  // ровно тот фон, который нужно вычесть из рабочего окна.
  const quiet = await window(async () => undefined);
  seen.length = 0;

  const sent = await window(async () => {
    const response = await request(`/v1/conversations/${owner.room}/messages`, {
      method: "POST",
      body: { body: "замер цены события", clientMsgId: crypto.randomUUID() },
      cookie: sender,
    });
    if (!response.ok) throw new Error(`отправка: ${response.status}`);
  });

  for (const controller of held) controller.abort();

  const cost = sent - quiet;
  const perTab = held.length === 0 ? 0 : cost / held.length;

  console.log("\n── что получилось ─────────────────────────────────");
  console.log(`вкладок:                 ${held.length} (смотрят: ${WATCHING})`);
  console.log(`событий в потоках:       ${seen.length}`);
  console.log(`транзакций в тишине:     ${quiet}`);
  console.log(`транзакций с сообщением: ${sent}`);
  console.log(`цена одного сообщения:   ${cost} транзакций`);
  console.log(`на вкладку:              ${perTab.toFixed(2)}`);
  console.log(
    cost > held.length / 2
      ? "\n↑ цена растёт вместе с числом вкладок — это Д-3 числом."
      : "\n✓ цена не зависит от числа вкладок.",
  );
  console.log("\n⚠️ Оговорка: считаются ТРАНЗАКЦИИ, не операторы; запись из нескольких");
  console.log("   операторов считается одной. Цена раздачи от этого точна, цена записи");
  console.log("   занижена. Замер с одной машины.");
}

run().catch((error) => {
  if (error instanceof OwnRateLimitError) {
    console.error(`\n⚠️ упёрлись в СВОЙ порог частоты (${error.message}) — это не предел сервера.`);
    process.exit(2);
  }
  console.error("\nзамер не состоялся:", error.message);
  process.exit(1);
});
