#!/usr/bin/env node

/**
 * Потолок записи в одно пространство (Д-2, task-081).
 *
 * ЧТО МЕРЯЕТ. Сколько реплик в секунду принимает ОДНО пространство, когда
 * люди пишут одновременно, и как при этом растёт задержка ответа
 * на отправку. Слушателей нет вовсе: раздачу событий меряют другие приборы
 * (`make load`, `make event-cost`), и здесь она только мешала бы.
 *
 * ЗАЧЕМ ИМЕННО ЭТА ОСЬ. Номер реплики берётся `UPDATE` строки пространства
 * внутри транзакции (`talk/repo.ts:nextSeq`), и блокировка держится
 * до ФИКСАЦИИ — то есть под замком идёт вся транзакция отправки. Значит
 * записи пространства выстраиваются в одну очередь. Это единственный
 * известный упор, который **не поднимается вторым процессом**: узкое место
 * — одна строка, и все процессы встанут к ней в ту же очередь.
 *
 * ⚠️ ДВА ПРОГОНА, А НЕ ОДИН, И ЭТО НЕ ПЕДАНТИЗМ. `SPREAD=same` — все пишут
 * в один разговор одного пространства; `SPREAD=spaces` — каждый в своё
 * пространство. Если задержка растёт только в первом случае, упор именно
 * в строке пространства. Без второго прогона замер скажет «медленно»
 * и не скажет, от чего, — а лечится это тремя разными способами.
 *
 * Запуск: make write-ceiling (стек должен быть поднят: make up)
 * Настройки: SENDERS=50 EACH=5 SPREAD=same make write-ceiling
 */

import { inviteLink, joined, registerOwner, request } from "./stand.mjs";

/** Сколько человек пишут одновременно. Уровень одновременности — это оно. */
const SENDERS = Number(process.env.SENDERS ?? 50);

/**
 * Сколько реплик пишет каждый.
 *
 * ⚠️ МАЛО НАРОЧНО. Порог отправки — 30 в минуту на человека (Р-025).
 * Упрёмся в него — запишем СВОЙ порог как потолок базы, и это была бы
 * та же ошибка, что уже случалась с измерителем трижды.
 */
const EACH = Number(process.env.EACH ?? 5);

/** `same` — все в один разговор; `spaces` — каждый в своё пространство. */
const SPREAD = process.env.SPREAD ?? "same";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

function percentile(sorted, share) {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * share));
  return sorted[at];
}

/** Одна отправка: сколько миллисекунд ждал человек и сколько это стоило базе. */
async function sendOnce(who, n) {
  const started = performance.now();
  const response = await request(`/v1/conversations/${who.room}/messages`, {
    method: "POST",
    body: { body: `замер записи ${n}`, clientMsgId: crypto.randomUUID() },
    cookie: who.cookie,
  });
  const took = performance.now() - started;
  // Отказ не превращаем в ноль: молча посчитанный отказ выглядел бы
  // как быстрый ответ и улучшил бы числа ровно там, где стало плохо.
  if (!response.ok) return { took, failed: response.status };
  return { took, queries: Number(response.headers.get("x-db-queries") ?? 0) };
}

/** Один человек пишет свои реплики подряд, как пишет человек. */
async function sender(who) {
  const mine = [];
  for (let n = 0; n < EACH; n++) mine.push(await sendOnce(who, n));
  return mine;
}

/**
 * Все пишут в один разговор одного пространства — худший случай нарочно.
 * Один владелец, одна ссылка-приглашение: столько же, сколько сделал бы
 * человек, зовущий коллег.
 */
async function intoOneSpace() {
  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, SENDERS);
  const people = [owner];
  for (let n = 1; n < SENDERS; n++) {
    people.push({ cookie: await joined(token, `w${n}`), room: owner.room });
  }
  return people;
}

/** Каждый пишет в своё пространство: очереди к общей строке нет. */
async function intoOwnSpaces() {
  const people = [];
  for (let n = 0; n < SENDERS; n++) people.push(await registerOwner());
  return people;
}

function report(results, seconds) {
  const failures = results.filter((one) => one.failed);
  const good = results.filter((one) => !one.failed).map((one) => one.took);
  const sorted = [...good].sort((a, b) => a - b);
  const queries = results.reduce((sum, one) => sum + (one.queries ?? 0), 0);

  const say = (share) => `${Math.round(percentile(sorted, share))}`;
  console.log(
    `${SENDERS} отправителей × ${EACH} реплик (${SPREAD}): ` +
      `${good.length} принято за ${seconds.toFixed(1)} с ` +
      `= ${(good.length / seconds).toFixed(1)} записей в секунду`,
  );
  console.log(
    `задержка ответа: половина ${say(0.5)} · 0.9 ${say(0.9)} · ` +
      `0.99 ${say(0.99)} · худший ${Math.round(sorted.at(-1) ?? 0)} мс`,
  );
  console.log(`запросов к базе на одну запись: ${(queries / (good.length || 1)).toFixed(1)}`);

  if (failures.length > 0) {
    const codes = [...new Set(failures.map((one) => one.failed))].join(", ");
    console.log(
      `⚠️ отказов ${failures.length} из ${results.length} (${codes}). ` +
        `429 — это НАШ порог частоты, а не потолок базы: убавь EACH.`,
    );
  }
}

const health = await fetch(`${BASE}/health`);
if (!health.ok) {
  console.error("стек не поднят — сначала make up");
  process.exit(1);
}

const people = SPREAD === "spaces" ? await intoOwnSpaces() : await intoOneSpace();

// Волна: все начинают разом. Ждать друг друга по очереди значило бы мерить
// один запрос N раз, а нам нужна очередь к строке пространства.
const startedAt = performance.now();
const waves = await Promise.all(people.map(sender));
const seconds = (performance.now() - startedAt) / 1000;

report(waves.flat(), seconds);
