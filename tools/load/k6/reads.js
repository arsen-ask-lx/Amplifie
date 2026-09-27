/**
 * Горячие двери чтения под нагрузкой — k6, второй измеритель (task-122, Р-051).
 *
 * Панель, лента, догон и поиск по чатам: на каждую дверь свой порог 0.99,
 * отказы сервера — ноль. Порог нарушен — k6 выходит с ненулевым кодом, и это
 * красный `make k6` и красный шаг CI.
 *
 * ⚠️ СВОЙ КОД, НИ СТРОКИ ИЗ `tools/load/stand.mjs`. Вход, приглашение и формы
 * ответов написаны заново по `backend/openapi.json`: общий код сделал бы два
 * прибора одним, и сверка ничего бы не доказывала.
 *
 * ⚠️ ДОГОН — ДВЕ ДВЕРИ, И ЭТО НЕ ДУБЛЬ. Клиент с курсором у головы получает ответ
 * из памяти (хвост изменений, `platform/tail.ts`) — это самый частый путь.
 * Отставший (`after=0`) всегда идёт в базу. Одна дверь «догон» мерила бы
 * только второй случай и молчала бы о первом.
 *
 * ⚠️ БЮДЖЕТ ПОРОГОВ ЧАСТОТЫ ПОСЧИТАН, А НЕ УГАДАН. k6 ходит из своего контейнера —
 * у него один свой адрес. Панель и лента живут под общим порогом по адресу;
 * догон и поиск — по человеку, проходы разложены по PEOPLE людям. Числа ниже —
 * КОПИЯ `backend/src/surface/http/limits.ts` (стенд, Р-025). Разойдутся — прогон
 * упрётся в свой порог, а он краснеет отдельным счётчиком: 429 не провал сервера,
 * но и зелёным не проходит.
 *
 * Запуск: make k6 (стенд поднят: make up).
 */
import { check, fail } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE ?? "http://caddy:80";
const RATE = Number(__ENV.RATE ?? 10);
const DURATION = __ENV.DURATION ?? "30s";
const PEOPLE = Number(__ENV.PEOPLE ?? 10);
const P99_MS = Number(__ENV.P99_MS ?? 1500);
const PASSWORD = "k6-parol-dlya-zamera-dlinnyi";
const DOORS = ["panel", "feed", "sync_hot", "sync_cold", "search"];
/** Каналов с «k6» в названии: поиск по пустой выдаче ничего бы не мерил. */
const CHATS = 5;

/** Копия порогов стенда из `limits.ts`, в минуту. */
const LIMIT = { overallPerAddress: 5000, syncPerPerson: 600, searchPerPerson: 120 };

/** Упёрлись в свой порог частоты — это не предел сервера (Р-025). */
const ownLimit = new Counter("own_rate_limit");

// 429 — не провал сервера: иначе порог `http_req_failed` мерил бы наш лимитер.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

/** Сколько проходов в секунду влезает в пороги — выше замер мерил бы нас самих. */
function ceiling() {
  const perPerson = (perMinute, perPass) => (perMinute * PEOPLE) / (perPass * 60);
  return Math.floor(
    Math.min(
      LIMIT.overallPerAddress / (2 * 60), // панель + лента
      perPerson(LIMIT.syncPerPerson, 2), // два догона
      perPerson(LIMIT.searchPerPerson, 1),
    ),
  );
}

if (RATE > ceiling()) {
  throw new Error(
    `RATE=${RATE} выше порогов частоты: при PEOPLE=${PEOPLE} потолок ${ceiling()} в секунду`,
  );
}

export const options = {
  scenarios: {
    reads: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.max(4, RATE * 2),
      maxVUs: RATE * 10,
    },
  },
  thresholds: {
    http_req_failed: ["rate==0"],
    own_rate_limit: ["count==0"],
    // Каждая проверка: 200 и непустой поиск — иначе мерили бы пустую выдачу.
    checks: ["rate==1"],
    // Встал сервер — нагрузка молча падает, а 0.99 считается по меньшей выборке.
    dropped_iterations: ["count==0"],
    ...Object.fromEntries(
      DOORS.map((door) => [`http_req_duration{door:${door}}`, [`p(99)<${P99_MS}`]]),
    ),
  },
  summaryTrendStats: ["p(50)", "p(90)", "p(99)", "max"],
};

function post(path, body, cookie, door = "setup") {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    tags: { door },
  });
}

function get(path, cookie, door = "setup") {
  return http.get(`${BASE}${path}`, { headers: { cookie }, tags: { door } });
}

function sessionOf(response, what) {
  if (response.status !== 200 && response.status !== 201) {
    fail(`${what}: ${response.status} ${response.body}`);
  }
  const value = response.cookies.amplifie_session?.[0]?.value;
  if (!value) fail(`${what}: сервер не выдал печеньку сессии`);
  return `amplifie_session=${value}`;
}

function created(response, what) {
  if (response.status !== 200 && response.status !== 201) {
    fail(`${what}: ${response.status} ${response.body}`);
  }
  return response;
}

/**
 * Одно пространство на прогон: владелец, каналы, приглашение и PEOPLE человек.
 * Каждый пишет несколько реплик — пустая лента отвечает быстро и ничего не мерит.
 */
export function setup() {
  const run = `${Date.now()}`;
  const owner = sessionOf(
    post("/v1/auth/register", {
      email: `k6-${run}-owner@amplifie.test`,
      password: PASSWORD,
      displayName: "k6 владелец",
      workspaceName: `k6 ${run}`,
    }),
    "регистрация",
  );
  const room = get("/v1/panel", owner).json().recent.items[0]?.id;
  if (!room) fail("у нового пространства нет канала");
  for (let n = 0; n < CHATS; n++) {
    created(
      post("/v1/conversations", { title: `k6 канал ${n}`, visibility: "workspace" }, owner),
      "канал",
    );
  }

  const invite = created(post("/v1/invites", { maxUses: PEOPLE + 1 }, owner), "приглашение");
  const people = [];
  for (let n = 0; n < PEOPLE; n++) {
    const cookie = sessionOf(
      post("/v1/auth/join", {
        token: invite.json().token,
        email: `k6-${run}-${n}@amplifie.test`,
        password: PASSWORD,
        displayName: `k6 ${n}`,
      }),
      `вход ${n}`,
    );
    for (let line = 0; line < 5; line++) {
      created(
        post(
          `/v1/conversations/${room}/messages`,
          { body: `k6 реплика ${n}-${line}`, clientMsgId: crypto.randomUUID() },
          cookie,
        ),
        "реплика",
      );
    }
    people.push(cookie);
  }

  // Курсор у головы — чуть позади, как у вкладки, пропустившей пару реплик.
  const head = get("/v1/sync?after=0&limit=500", owner).json().seq;
  return { room, people, near: Math.max(0, head - 5) };
}

export default function ({ room, people, near }) {
  const cookie = people[(__VU + __ITER) % people.length];
  const replies = [
    get("/v1/panel", cookie, "panel"),
    get(`/v1/conversations/${room}/messages?limit=50`, cookie, "feed"),
    get(`/v1/sync?after=${near}&limit=100`, cookie, "sync_hot"),
    get("/v1/sync?after=0&limit=100", cookie, "sync_cold"),
    post("/v1/search/chats", { q: "k6" }, cookie, "search"),
  ];
  replies.forEach((reply, at) => {
    if (reply.status === 429) ownLimit.add(1, { door: DOORS[at] });
    check(reply, { 200: (one) => one.status === 200 });
  });
  check(replies[4], { "поиск нашёл каналы": (one) => (one.json().items ?? []).length > 0 });
}
