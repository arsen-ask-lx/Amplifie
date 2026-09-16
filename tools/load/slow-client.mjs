#!/usr/bin/env node

/**
 * Что делает ОДИН медленный клиент с памятью единственного процесса (Д-14).
 *
 * ЗАЧЕМ ИМЕННО ЭТО. С task-085 в трубу едет не адрес в десяток байт,
 * а целая реплика — до восьми килобайт. Клиент, который перестал забирать
 * (телефон в метро, вкладка в спящем ноутбуке, зависший браузер), копит их
 * в памяти НАШЕГО процесса. Отказ здесь не плавный: кончается память
 * и падает всё сразу, а не медленно у одного.
 *
 * КАК УСТРОЕН ПРИБОР. Открывается голое соединение, которое честно
 * представляется и НИ РАЗУ НЕ ЧИТАЕТ: данные наполняют буфер ядра, потом
 * буфер сокета в процессе, и это видно числом `amplifie_stream_backlog_bytes`.
 * Рядом держится обычный читающий клиент — чтобы увидеть, задевает ли его
 * сосед.
 *
 * ⚠️ ПОРОГИ ЧАСТОТЫ НАШИ ЖЕ. Отправка — 30 в минуту на человека (Р-025),
 * поэтому пишут несколько человек сразу. Иначе упрёмся в свой порог
 * и запишем его как «проблемы нет».
 *
 * Запуск: make slow-client (стек должен быть поднят: make up)
 * Настройки: SLOW=1 SENDERS=3 EACH=25 SIZE=8000 make slow-client
 */

import { connect } from "node:net";
import { inviteLink, joined, registerOwner, request } from "./stand.mjs";

/** Сколько клиентов перестали читать. */
const SLOW = Number(process.env.SLOW ?? 1);

/** Сколько человек пишут (порог отправки — 30 в минуту на человека). */
const SENDERS = Number(process.env.SENDERS ?? 3);

/** Сколько реплик пишет каждый. */
const EACH = Number(process.env.EACH ?? 25);

/** Длина реплики. Предел контракта — 8000 знаков. */
const SIZE = Number(process.env.SIZE ?? 8000);

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const INSIDE = process.env.AMPLIFIE_API_URL ?? "http://localhost:3477";

async function numbers() {
  const text = await (await fetch(`${INSIDE}/metrics`)).text();
  const value = (name) => {
    const line = text.split("\n").find((one) => one.startsWith(`${name} `));
    return line ? Number(line.split(" ")[1]) : null;
  };
  return {
    backlog: value("amplifie_stream_backlog_bytes"),
    heap: value("amplifie_heap_bytes"),
    streams: value("amplifie_streams"),
    dropped: value("amplifie_streams_dropped_total"),
  };
}

/**
 * Соединение, которое НЕ ЧИТАЕТ.
 *
 * ⚠️ `fetch` для этого не годится: он читает тело сам, как бы мы ни просили.
 * Нужен голый сокет, которому не сказали `resume()` — тогда данные копятся
 * сперва у ядра, а потом у нас.
 */
function deaf(cookie) {
  const url = new URL(INSIDE);
  const socket = connect({ host: url.hostname, port: Number(url.port) });
  socket.on("error", () => undefined);
  socket.write(
    `GET /v1/stream HTTP/1.1\r\nHost: ${url.host}\r\n` +
      `Accept: text/event-stream\r\nCookie: ${cookie}\r\n` +
      "Connection: keep-alive\r\n\r\n",
  );
  // Ни одного `on("data")` и ни одного `resume()` — в этом весь смысл.
  return socket;
}

/** Обычный клиент рядом: он читает и обязан не пострадать от соседа. */
async function healthy(cookie, seen) {
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie, accept: "text/event-stream" },
  });
  const body = response.body;
  if (!body) throw new Error("у потока нет тела");
  const reader = body.getReader();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (new TextDecoder().decode(value).includes("data:")) seen.push(Date.now());
      }
    } catch {
      // Поток закрыли — конец замера, а не поломка.
    }
  })();
  return reader;
}

const health = await fetch(`${BASE}/health`);
if (!health.ok) {
  console.error("стек не поднят — сначала make up");
  process.exit(1);
}

const owner = await registerOwner();
const token = await inviteLink(owner.cookie, SLOW + SENDERS + 2);

const deafOnes = [];
for (let n = 0; n < SLOW; n++) deafOnes.push(deaf(await joined(token, `deaf${n}`)));

const seen = [];
await healthy(await joined(token, "healthy"), seen);

const writers = [owner.cookie];
for (let n = 1; n < SENDERS; n++) writers.push(await joined(token, `writer${n}`));

await new Promise((resolve) => setTimeout(resolve, 500));
const before = await numbers();

const text = "щ".repeat(SIZE);
let sent = 0;
let refused = 0;
await Promise.all(
  writers.map(async (cookie) => {
    for (let n = 0; n < EACH; n++) {
      const response = await request(`/v1/conversations/${owner.room}/messages`, {
        method: "POST",
        body: { body: text, clientMsgId: crypto.randomUUID() },
        cookie,
      });
      if (response.ok) sent += 1;
      else refused += 1;
      await response.arrayBuffer();
    }
  }),
);

await new Promise((resolve) => setTimeout(resolve, 2000));
const after = await numbers();

console.log(`${SLOW} не читающих, ${SENDERS} пишущих по ${EACH} реплик в ${SIZE} знаков`);
console.log(`  отправлено ${sent}, отказано ${refused} (порог частоты — наш, Р-025)`);
console.log(`  открытых труб: ${before.streams} → ${after.streams}`);
console.log(
  `  НЕ ЗАБРАНО КЛИЕНТАМИ: ${before.backlog} → ${after.backlog} байт ` +
    `(${(((after.backlog ?? 0) - (before.backlog ?? 0)) / 1024).toFixed(0)} КБ)`,
);
console.log(
  `  куча процесса: ${((before.heap ?? 0) / 1024 / 1024).toFixed(1)} → ` +
    `${((after.heap ?? 0) / 1024 / 1024).toFixed(1)} МБ`,
);
console.log(`  оборвано сервером: ${after.dropped ?? "числа нет"}`);
console.log(`  читающий сосед получил событий: ${seen.length}`);

for (const one of deafOnes) one.destroy();
process.exit(0);
