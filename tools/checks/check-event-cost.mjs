#!/usr/bin/env node

/**
 * Гейт: цена одного события не растёт вместе с числом слушателей.
 *
 * ЗАЧЕМ ИМЕННО ЭТА ОСЬ. У нас уже есть гейт цены по объёму данных
 * (`backend/tests/query-budget.e2e.test.ts`: дверь на 2 чатах стоит столько
 * же, сколько на 20). Он был зелёный и был прав — каждая дверь по отдельности
 * дешёвая. А цена росла по ДРУГОЙ оси: по числу открытых вкладок. Сто вкладок
 * давали 209 транзакций базы на одну реплику, и ни один гейт этого не видел,
 * потому что никто не мерил вторую ось (разбор — dock/incidents, запись
 * «прибор был зелёным из-за обстановки»).
 *
 * ЧТО МЕРЯЕТ. Одно отправленное сообщение при N и при 2N подключённых
 * вкладках. Растёт цена — значит вернулось стадо: каждая вкладка снова
 * что-то делает на каждое событие.
 *
 * ХУДШИЙ СЛУЧАЙ НАРОЧНО. Вкладки смотрят ТОТ ЖЕ разговор, куда пришло
 * сообщение. Это чат-общежитие: объявления, общий чат компании. Если мерить
 * вкладки с разными чатами, гейт был бы зелёным и бесполезным.
 *
 * ХРАПОВИК. Известный прирост записан в `tools/ratchets/event-cost.txt`
 * и может только уменьшаться. Сегодня он не ноль: на каждый приход вкладки
 * остаются два запроса к базе на проверку сессии (Д-39). Гейт стережёт,
 * чтобы не стало хуже, и потребует уменьшить число, когда Д-39 будет закрыт.
 *
 * Запуск: make event-cost (стек должен быть поднят: make up)
 */

import { readFileSync } from "node:fs";
import { holdTabs, inviteLink, registerOwner, releaseTabs, request } from "../load/stand.mjs";

const RATCHET = "tools/ratchets/event-cost.txt";

/** Два объёма для сравнения: прирост считается между ними. */
const SMALL = Number(process.env.SMALL ?? 20);
const LARGE = Number(process.env.LARGE ?? 40);

/**
 * Сколько ждём, пока вкладки отреагируют на событие.
 *
 * Считаем не время, а запросы, поэтому окно нужно только чтобы стадо успело
 * добежать. Не успело — число выйдет заниженным, поэтому окно щедрое.
 */
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 10_000);

/**
 * Запас на дрожание стенда.
 *
 * Не ноль: числа получены на живой машине, где рядом работают браузер
 * и docker. Полтора десятых транзакции на вкладку — это шум, а не регресс.
 */
const SLACK = 0.15;

function allowed() {
  try {
    return Number(readFileSync(RATCHET, "utf8").trim());
  } catch {
    throw new Error(
      `нет храповика ${RATCHET}\n` +
        `  ПОЧИНИТЬ: запусти замер и запиши в файл полученный прирост\n` +
        `  на вкладку — он станет потолком, который можно только опускать.`,
    );
  }
}

/**
 * Цена одного сообщения при заданном числе вкладок — в запросах к базе.
 *
 * Считается сумма: запросы самой отправки плюс запросы всех догонов, которые
 * вкладки сделали в ответ. Оба числа приходят заголовком от сервера.
 */
async function costAt(tabs) {
  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, tabs + 2);

  const workers = await holdTabs(token, owner.room, tabs);

  const sent = await request(`/v1/conversations/${owner.room}/messages`, {
    method: "POST",
    body: { body: "замер цены события", clientMsgId: crypto.randomUUID() },
    cookie: owner.cookie,
  });
  if (!sent.ok) throw new Error(`отправка: ${sent.status}`);
  const write = Number(sent.headers.get("x-db-queries") ?? 0);
  if (write === 0) throw new Error("стенд не отдал x-db-queries — это не стенд");

  await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
  const reaction = await releaseTabs(workers);

  return { total: write + reaction.queries, write, ...reaction };
}

const health = await fetch(`${process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477"}/health`);
if (!health.ok) {
  console.error("стек не поднят — сначала make up");
  process.exit(1);
}

const limit = allowed();
const small = await costAt(SMALL);
const large = await costAt(LARGE);
const growth = (large.total - small.total) / (LARGE - SMALL);

const say = (tabs, at) =>
  console.log(
    `${tabs} вкладок: ${at.total} запросов к базе ` +
      `(запись ${at.write}, догонов ${at.syncs}, панелей ${at.panels})`,
  );
say(SMALL, small);
say(LARGE, large);
console.log(`прирост на вкладку: ${growth.toFixed(2)} (разрешено ${limit})`);

if (growth > limit + SLACK) {
  console.error(
    `\nцена события растёт с числом вкладок: ${growth.toFixed(2)} на вкладку\n` +
      `  при разрешённых ${limit}.\n` +
      `  ПОЧИНИТЬ: найди, что вкладка делает на КАЖДОЕ событие. Событие обязано\n` +
      `  нести всё нужное само — тогда вкладке незачем ходить на сервер\n` +
      `  (Р-038, task-067). Если число уменьшилось осознанно — опусти храповик\n` +
      `  ${RATCHET} тем же коммитом.`,
  );
  process.exit(1);
}

if (growth + 2 * SLACK < limit) {
  console.error(
    `\nстало лучше, чем записано: ${growth.toFixed(2)} против ${limit}.\n` +
      `  ПОЧИНИТЬ: опусти храповик ${RATCHET} до нового числа — иначе завтра\n` +
      `  регресс до старого значения пройдёт незамеченным.`,
  );
  process.exit(1);
}

console.log("цена события не растёт с числом слушателей — OK");
