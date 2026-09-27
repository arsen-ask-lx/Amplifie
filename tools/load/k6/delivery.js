/**
 * Доставка до чужой вкладки — k6, второй измеритель (task-122, Р-051).
 *
 * TABS вкладок держат поток `/v1/stream`, отправители шлют RATE реплик в секунду.
 * Меряем три числа: ответ на отправку, долю доставки и — впервые — время от
 * отправки до события у чужой вкладки. Время отправки едет в тексте реплики:
 * событие везёт реплику с собой (task-085), часы у отправителя и вкладки одни —
 * это один процесс k6.
 *
 * ⚠️ ВКЛАДКИ ТОЛЬКО СЛУШАЮТ. Догона и панели нет намеренно: повторять поведение
 * клиента — третья копия, а две первые расходились (task-091). Сверка с нашим
 * прибором идёт в том же режиме: `SYNC=0 make load`.
 *
 * ⚠️ ДОЛЯ ДОСТАВКИ — ОДНА ФОРМУЛА С НАШИМ ПРИБОРОМ: доставок ÷ (успешных отправок ×
 * открытых вкладок). Здесь считаются только реплики замера, наш прибор считает
 * любое событие; совпадают, пока в пространстве нет других звонков — сейчас их
 * нет, а появятся — сверка покраснеет, а не соврёт.
 *
 * ⚠️ ОТПРАВКА НАЧИНАЕТСЯ ПО ЧАСАМ (OPEN_S), А НЕ ПОСЛЕ ОТКРЫТИЯ ВСЕХ ПОТОКОВ, как
 * у нашего прибора. Вкладка, открывшаяся позже, недосчитала бы доставки по вине
 * прибора, поэтому опоздавшие считаются отдельно и краснят прогон.
 *
 * ⚠️ СЛЕДЫ В БАЗЕ СТЕНДА: каждый прогон оставляет пространство, людей и реплики —
 * как и наш прибор с task-019. Арендаторы разделены, чужие замеры это не трогает;
 * чистит `make reset`.
 *
 * ⚠️ СВОЙ КОД, НИ СТРОКИ ИЗ `tools/load/stand.mjs`. Пороги частоты (Р-025) —
 * копия `limits.ts`: 8 вкладок на человека (открытых потоков можно 16),
 * отправок 30 в минуту на человека, входов по приглашению 500 в минуту на адрес.
 *
 * Запуск: make k6-sse (стенд поднят: make up; образ: tools/load/k6/Dockerfile).
 */
import { fail } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";
import sse from "k6/x/sse";

const BASE = __ENV.BASE ?? "http://caddy:80";
const TABS = Number(__ENV.TABS ?? 20);
const RATE = Number(__ENV.RATE ?? 5);
const SECONDS = Number(__ENV.SEND_S ?? 20);
const PASSWORD = "k6-parol-dlya-zamera-dlinnyi";
const TABS_PER_PERSON = 8;
/** Отправитель шлёт не больше 25 в минуту — запас от порога 30 (SEND в limits.ts). */
const SENDERS = Math.max(2, Math.ceil((RATE * 60) / 25));
/** Сколько ждём, пока все вкладки откроют поток, и сколько — хвост доставки. */
const OPEN_S = Math.max(10, Math.ceil(TABS / 20));
const DRAIN_S = 5;
const MARK = "k6d";
const STOP = "k6d-стоп";

const delivery = new Trend("delivery_ms", true);
const delivered = new Counter("delivered");
const sent = new Counter("sent_ok");
const ownLimit = new Counter("own_rate_limit");
const opened = new Counter("streams_opened");
const late = new Counter("streams_late");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const options = {
  setupTimeout: "5m",
  scenarios: {
    tabs: {
      executor: "per-vu-iterations",
      vus: TABS,
      iterations: 1,
      maxDuration: `${OPEN_S + SECONDS + DRAIN_S + 30}s`,
      exec: "tab",
    },
    send: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: `${SECONDS}s`,
      startTime: `${OPEN_S}s`,
      preAllocatedVUs: Math.max(4, RATE * 2),
      maxVUs: RATE * 10,
      exec: "send",
    },
    stop: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      startTime: `${OPEN_S + SECONDS + DRAIN_S}s`,
      exec: "stop",
    },
  },
  thresholds: {
    http_req_failed: ["rate==0"],
    own_rate_limit: ["count==0"],
    dropped_iterations: ["count==0"],
    streams_opened: [`count==${TABS}`],
    streams_late: ["count==0"],
    // Порог нужен и ради того, чтобы k6 посчитал отправку отдельно: без него доли нет.
    "http_req_duration{door:send}": ["p(99)<5000"],
  },
  summaryTrendStats: ["p(50)", "p(90)", "p(99)", "max"],
};

function post(path, body, cookie, door = "setup") {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    tags: { door },
  });
}

function sessionOf(response, what) {
  if (response.status !== 200 && response.status !== 201) {
    fail(`${what}: ${response.status} ${response.body}`);
  }
  const value = response.cookies.amplifie_session?.[0]?.value;
  if (!value) fail(`${what}: сервер не выдал печеньку сессии`);
  return `amplifie_session=${value}`;
}

export function setup() {
  const run = `${Date.now()}`;
  const owner = sessionOf(
    post("/v1/auth/register", {
      email: `k6d-${run}-owner@amplifie.test`,
      password: PASSWORD,
      displayName: "k6 владелец",
      workspaceName: `k6 доставка ${run}`,
    }),
    "регистрация",
  );
  const panel = http.get(`${BASE}/v1/panel`, { headers: { cookie: owner } }).json();
  const room = panel.recent.items[0]?.id;
  if (!room) fail("у нового пространства нет канала");

  const listeners = Math.ceil(TABS / TABS_PER_PERSON);
  const invite = post("/v1/invites", { maxUses: listeners + SENDERS + 1 }, owner).json();
  const join = (tag) =>
    sessionOf(
      post("/v1/auth/join", {
        token: invite.token,
        email: `k6d-${run}-${tag}@amplifie.test`,
        password: PASSWORD,
        displayName: `k6 ${tag}`,
      }),
      `вход ${tag}`,
    );
  const people = Array.from({ length: listeners }, (_, n) => join(`tab${n}`));
  const senders = Array.from({ length: SENDERS }, (_, n) => join(`send${n}`));
  return { room, people, senders, owner };
}

/** Вкладка: держит поток, пока не увидит реплику-сигнал. */
export function tab({ people }) {
  // Номер прохода внутри сценария, а не `__VU`: номера VU общие на все сценарии,
  // и вкладок на одного человека могло стать больше порога (16 открытых потоков).
  const at = exec.scenario.iterationInTest;
  const cookie = people[Math.floor(at / TABS_PER_PERSON)];
  const sendingFrom = exec.scenario.startTime + OPEN_S * 1000;
  const response = sse.open(`${BASE}/v1/stream`, { headers: { cookie } }, (client) => {
    client.on("open", () => {
      opened.add(1);
      if (Date.now() > sendingFrom) late.add(1);
    });
    client.on("event", (event) => {
      const body = JSON.parse(event.data || "{}")?.line?.body ?? "";
      if (body === STOP) {
        client.close();
        return;
      }
      if (!body.startsWith(`${MARK} `)) return;
      delivery.add(Date.now() - Number(body.split(" ")[1]));
      delivered.add(1);
    });
    client.on("error", (error) => console.error(`вкладка ${__VU}: ${error.error()}`));
  });
  if (response?.status !== 200) {
    console.error(`вкладка ${__VU}: поток ответил ${response?.status}`);
  }
}

export function send({ room, senders }) {
  // Общий номер прохода, а не свой у каждого VU: `__ITER` у разных VU совпадает, и
  // одни отправители шли чаще других — 480 отказов по своему порогу (27.09).
  const cookie = senders[exec.scenario.iterationInTest % senders.length];
  const reply = post(
    `/v1/conversations/${room}/messages`,
    { body: `${MARK} ${Date.now()} ${crypto.randomUUID()}`, clientMsgId: crypto.randomUUID() },
    cookie,
    "send",
  );
  if (reply.status === 429) ownLimit.add(1);
  else if (reply.status === 201) sent.add(1);
}

export function stop({ room, owner }) {
  const reply = post(
    `/v1/conversations/${room}/messages`,
    { body: STOP, clientMsgId: crypto.randomUUID() },
    owner,
  );
  // Без сигнала вкладки ждут до `maxDuration` — прогон затянется, а не соврёт.
  if (reply.status !== 201) fail(`сигнал «стоп»: ${reply.status}`);
}

/**
 * Строка итога в JSON — её читает сверка с нашим прибором (`make k6-compare`).
 * Она заменяет обычную таблицу k6: таблица требует библиотеку из сети
 * (jslib k6-summary), а нарушенные пороги k6 и так печатает сам и выходит
 * с ненулевым кодом — его сверка и проверяет.
 */
export function handleSummary(data) {
  const count = (name) => data.metrics[name]?.values.count ?? 0;
  const trend = (name) => data.metrics[name]?.values ?? {};
  const send = data.metrics["http_req_duration{door:send}"]?.values ?? {};
  const expected = count("sent_ok") * count("streams_opened");
  const result = {
    tool: "k6",
    tabs: count("streams_opened"),
    sent: count("sent_ok"),
    delivered: count("delivered"),
    share: expected ? count("delivered") / expected : 0,
    sendMs: { p50: send["p(50)"], p90: send["p(90)"], p99: send["p(99)"] },
    deliveryMs: {
      p50: trend("delivery_ms")["p(50)"],
      p90: trend("delivery_ms")["p(90)"],
      p99: trend("delivery_ms")["p(99)"],
    },
    ownLimit: count("own_rate_limit"),
    late: count("streams_late"),
  };
  return { stdout: `\nИТОГ-JSON ${JSON.stringify(result)}\n` };
}
