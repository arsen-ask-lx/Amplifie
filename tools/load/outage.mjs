#!/usr/bin/env node
/**
 * Выкладка посреди прогона: переживают ли вкладки простой сервера (task-093).
 *
 * ЗАЧЕМ. Живым опытом прожито: пока `api` лежит, Caddy отвечает 502,
 * и вкладка на `EventSource` глохла навсегда. Клиент научен возвращаться
 * с разбросом и догонять. Этот прибор отвечает числами на то, что
 * UI-сценарий на одной вкладке ответить не может:
 *   · возвращаются ли ВСЕ вкладки и за сколько секунд;
 *   · чего это стоит серверу — сколько догонов, сколько отказов 5xx,
 *     какая очередь к пулу на волне;
 *   · доходят ли реплики до всех после возвращения (мёртвых держателей нет).
 *
 * ⚠️ ИЗНУТРИ СЕТИ СТЕНДА И С СОКЕТОМ DOCKER. Остановить `api` можно только
 * снаружи процесса `api`; CLI `docker` в образе Node нет, поэтому прибор
 * говорит с Docker Engine API по сокету напрямую. Проброс портов Windows
 * рвёт соединения после ~1700 труб (task-091), поэтому к `api:3000`:
 *
 *   docker run --rm --network amplifie_default \
 *     -v "E:/Amplifie:/work" -w /work -v /var/run/docker.sock:/var/run/docker.sock \
 *     -e AMPLIFIE_BASE_URL=http://api:3000 -e TABS=3000 -e DOWN_S=10 \
 *     node:24-bookworm-slim node tools/load/outage.mjs
 *
 * ⚠️ ОН ОСТАНАВЛИВАЕТ НАСТОЯЩИЙ `api` СТЕНДА. На время прогона стенд
 * недоступен всем, кто им пользуется.
 */

import { request as httpRequest } from "node:http";
import {
  BASE,
  holdTabs,
  inviteLink,
  joined,
  registerOwner,
  releaseTabs,
  reportLag,
  reportRefusals,
  request,
} from "./stand.mjs";

const TABS = Number(process.env.TABS ?? 500);
const DOWN_S = Number(process.env.DOWN_S ?? 10);
const MESSAGES = Number(process.env.MESSAGES ?? 20);
const API_CONTAINER = process.env.API_CONTAINER ?? "amplifie-api-1";

/**
 * Сколько ждём возвращения всех вкладок. Потолок задержки у клиента —
 * 30 с, плюс подъём `api`; дольше двух минут — это уже не волна, а отказ.
 */
const RECOVERY_LIMIT_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Команда Docker Engine API по сокету: остановить или поднять контейнер. */
function docker(action) {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      {
        socketPath: "/var/run/docker.sock",
        method: "POST",
        path: `/containers/${API_CONTAINER}/${action}${action === "stop" ? "?t=2" : ""}`,
      },
      (response) => {
        response.resume();
        // 304 — уже в нужном состоянии; это не ошибка.
        if (response.statusCode === 204 || response.statusCode === 304) resolve();
        else reject(new Error(`docker ${action}: ${response.statusCode}`));
      },
    );
    call.on("error", reject);
    call.end();
  });
}

/** Числа сервера, нужные волне. Сервер лежит — `null`, а не выдуманный ноль. */
async function serverNumbers() {
  try {
    const text = await (await fetch(`${BASE}/metrics`)).text();
    const sum = (pattern) =>
      [...text.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);
    return {
      streams: sum(/^amplifie_streams (\S+)/gmu),
      waiting: sum(/^amplifie_pool_waiting (\S+)/gmu),
      failures: sum(/^amplifie_requests_total\{route="[^"]*",status="5\d\d"\} (\S+)/gmu),
      syncs: sum(/^amplifie_requests_total\{route="\/v1\/sync",status="\d+"\} (\S+)/gmu),
      panels: sum(/^amplifie_requests_total\{route="\/v1\/panel",status="\d+"\} (\S+)/gmu),
    };
  } catch {
    return null;
  }
}

/** Ждать, пока сервер снова держит все вкладки. Отдаёт волну числами. */
async function waitForRecovery(since) {
  let maxWaiting = 0;
  for (;;) {
    const numbers = await serverNumbers();
    if (numbers) {
      maxWaiting = Math.max(maxWaiting, numbers.waiting);
      if (numbers.streams >= TABS) return { ms: Date.now() - since, maxWaiting, numbers };
    }
    if (Date.now() - since > RECOVERY_LIMIT_MS) {
      return { ms: null, maxWaiting, numbers };
    }
    await sleep(500);
  }
}

async function send(room, sender, n) {
  const response = await request(`/v1/conversations/${room}/messages`, {
    method: "POST",
    body: { body: `после выкладки ${n}`, clientMsgId: crypto.randomUUID() },
    cookie: sender,
  });
  return response.ok;
}

async function run() {
  console.log(
    `стенд: ${BASE} · вкладок ${TABS} · простой ${DOWN_S} с · контейнер ${API_CONTAINER}`,
  );

  const owner = await registerOwner();
  const token = await inviteLink(owner.cookie, TABS + 5);
  const workers = await holdTabs(token, owner.room, TABS);
  const sender = await joined(token, "sender");
  const before = await waitForRecovery(Date.now());
  if (before.ms === null) throw new Error("вкладки не открылись до выкладки");
  console.log(`открыто и держится: ${before.numbers.streams}`);

  await docker("stop");
  const downAt = Date.now();
  await sleep(DOWN_S * 1000);
  await docker("start");
  const wave = await waitForRecovery(downAt);

  // Даём догонам после возвращения закончиться, потом шлём реплики:
  // дойдут до всех — значит мёртвых вкладок нет.
  await sleep(5000);
  let sent = 0;
  for (let n = 0; n < MESSAGES; n++) if (await send(owner.room, sender, n)) sent += 1;
  await sleep(3000);
  const after = await serverNumbers();
  const tabs = await releaseTabs(workers);

  report({ wave, after, tabs, sent });
}

function report({ wave, after, tabs, sent }) {
  const expected = sent * TABS;
  console.log("\n── волна после выкладки ───────────────────────────");
  console.log(
    wave.ms === null
      ? `  ⚠️ НЕ ВЕРНУЛИСЬ за ${RECOVERY_LIMIT_MS / 1000} с: держится ${wave.numbers?.streams ?? "?"} из ${TABS}`
      : `  все ${TABS} вкладок снова на потоке через ${(wave.ms / 1000).toFixed(1)} с после остановки`,
  );
  console.log(
    `  вкладки: переподключений ${tabs.reconnects}, догонов ${tabs.syncs}, ` +
      `отказов догона ${tabs.syncFailures}, панелей ${tabs.panels}, конец сессии ${tabs.sessionEnded}`,
  );
  console.log(
    `  сервер с подъёма: догонов ${after?.syncs ?? "?"}, панелей ${after?.panels ?? "?"}, ` +
      `ответов 5xx ${after?.failures ?? "?"}, наибольшая очередь к пулу ${wave.maxWaiting}`,
  );
  console.log(
    `  после возвращения: событий ${tabs.seen} из ${expected} ожидаемых ` +
      `(${expected ? ((tabs.seen / expected) * 100).toFixed(2) : 0}%)`,
  );
  reportRefusals(tabs.refusals);
  reportLag(tabs.lagMs);
}

run().catch((error) => {
  console.error(`\nзамер не состоялся: ${error.message}`);
  const why = error?.cause;
  if (why) console.error("   причина:", why.code ?? why.message ?? String(why));
  process.exit(1);
});
