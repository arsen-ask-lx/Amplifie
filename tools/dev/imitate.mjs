// Игра в имитацию: соседи пишут владельцу так, как пишут живые люди.
//
// Зачем: сценарии проверок гоняют по одной вещи за раз и по чистому листу.
// Живой чат ломается на смеси — простыня посреди флуда, ответ на удалённое,
// зов в свёрнутом проекте. Владелец смотрит глазами, что работает, а что нет.
//
// Запуск из корня:
//   node tools/dev/imitate.mjs              — два сценария, давно не бывших
//   node tools/dev/imitate.mjs flood long   — названные
//   node tools/dev/imitate.mjs --list       — какие есть
//
// Учётки и пароль — те же, что у окон `tmp/dev-profiles/profiles.mjs`
// (пространство «Профили»); пароль лежит в tmp/dev-profiles/secret, вне git.
// Сколько раз какой сценарий шёл — tmp/dev-profiles/imitation-log.json.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "@playwright/test";

const BASE = process.env.STAND ?? "http://localhost:8477";
const SECRET = "tmp/dev-profiles/secret";
const LOG = "tmp/dev-profiles/imitation-log.json";
const OWNER = "Арсен";

if (!existsSync(SECRET)) {
  throw new Error("нет учёток соседей: сначала node tmp/dev-profiles/profiles.mjs");
}
const password = readFileSync(SECRET, "utf8").trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function person(email, name) {
  const api = await request.newContext({ baseURL: BASE });
  const r = await api.post("/v1/auth/login", { data: { email, password } });
  if (r.status() !== 200) throw new Error(`${name} не вошла: ${r.status()}`);
  return {
    name,
    async json(method, path, data) {
      const res = await api.fetch(path, { method, data });
      if (!res.ok()) throw new Error(`${name}: ${method} ${path} → ${res.status()}`);
      return res.status() === 204 ? null : res.json();
    },
    say(room, body, extra = {}) {
      return this.json("POST", `/v1/conversations/${room}/messages`, {
        body,
        clientMsgId: randomUUID(),
        ...extra,
      });
    },
  };
}

const marina = await person("marina@profiles.test", "Марина");
const pavel = await person("pavel@profiles.test", "Павел");

/** Чаты, где владелец есть: только в них его и ждёт непрочитанное. */
async function rooms() {
  const { items } = await marina.json("GET", "/v1/conversations");
  const withOwner = [];
  for (const room of items) {
    const people = await marina.json("GET", `/v1/conversations/${room.id}/people`);
    if (people.items.some((one) => one.name === OWNER)) withOwner.push(room);
  }
  if (withOwner.length === 0) throw new Error(`нет чатов, где есть ${OWNER}`);
  return withOwner;
}

async function ownerId(room) {
  const people = await marina.json("GET", `/v1/conversations/${room.id}/people`);
  return people.items.find((one) => one.name === OWNER)?.id;
}

async function lastOf(room, authorName) {
  const page = await marina.json("GET", `/v1/conversations/${room.id}/messages`);
  return [...page.items].reverse().find((one) => one.author?.name === authorName && one.body);
}

/* ── слова ──────────────────────────────────────────────────────────────── */

const SHORT = [
  "ок",
  "понял",
  "да",
  "секунду",
  "смотрю",
  "+",
  "принято",
  "а где акт сверки?",
  "скинь ОСВ по 60 счёту",
  "там расхождение 12 400",
  "клиент перенёс встречу",
  "уже отправила",
  "не, это не то",
  "подожди",
  "согласен",
  "👍",
  "сделаю к вечеру",
  "кто проверял выборку?",
  "ну такое",
  "в понедельник обсудим",
  "?",
  "!!!",
];

function essay() {
  const para = [
    "По итогам выборочной проверки дебиторской задолженности на 30.09: из 48 контрагентов подтверждения пришли от 31, по 9 есть расхождения, 8 не ответили вовсе.",
    "Основное расхождение — ООО «Вектор»: у нас 1 240 000, у них 1 180 000. Разница 60 000 похожа на неучтённый возврат товара от 14.08, но документа в папке нет.",
    "Предлагаю: 1) запросить у бухгалтерии клиента накладную на возврат; 2) по молчащим восьми — альтернативные процедуры, последующие поступления; 3) оценить, не системная ли это ошибка отражения возвратов.",
    "Отдельно по резерву сомнительных долгов: методика клиента не менялась три года, а просрочка свыше 90 дней выросла вдвое. Это стоит поднять на встрече с финдиректором.",
    "Если коротко: существенного искажения пока не вижу, но возвраты — зона риска, и без документов я бы вывод не подписывала.",
  ];
  const body = [];
  while (body.join("\n\n").length < 5000) body.push(...para);
  return body.join("\n\n").slice(0, 5200);
}

/* ── сценарии ───────────────────────────────────────────────────────────── */

const SCENARIOS = {
  flood: {
    about: "20 коротких подряд от двоих — непрочитанное, черта, прокрутка",
    async run(room) {
      for (let n = 0; n < 20; n++) {
        await (n % 3 === 0 ? pavel : marina).say(room.id, pick(SHORT));
        await sleep(150 + Math.random() * 450);
      }
    },
  },
  long: {
    about: "одна простыня ~5000 знаков — высота выше экрана, прочитанное",
    run: (room) => marina.say(room.id, essay()),
  },
  mention: {
    about: `зов @${OWNER} — значок @ у чата и у проекта`,
    async run(room) {
      const id = await ownerId(room);
      await pavel.say(
        room.id,
        `[${OWNER}](@${id}) глянь, пожалуйста, расхождение по «Вектору» — нужно твоё решение`,
      );
    },
  },
  reply: {
    about: "ответ цитатой на твою последнюю реплику",
    async run(room) {
      const mine = await lastOf(room, OWNER);
      if (!mine) return marina.say(room.id, "ты тут ещё ничего не писал — ответить не на что 🙂");
      await marina.say(room.id, "вот про это подробнее можно?", { replyToId: mine.id });
    },
  },
  edit: {
    about: "реплика с опечаткой и её правка через 4 с — «изменено»",
    async run(room) {
      const said = await pavel.say(room.id, "встреча в 15:00 в переговорке 3");
      await sleep(4000);
      await pavel.json("PATCH", `/v1/messages/${said.id}`, {
        body: "встреча в 16:30 в переговорке 5 (перенесли)",
      });
    },
  },
  remove: {
    about: "реплика и её удаление через 4 с — пропадает без следа у тебя",
    async run(room) {
      const said = await marina.say(room.id, "ой, это не сюда было — сейчас удалю");
      await sleep(4000);
      await marina.json("DELETE", `/v1/messages/${said.id}`);
    },
  },
  markdown: {
    about: "разметка: жирный, курсив, список, код, ссылка",
    run: (room) =>
      marina.say(
        room.id,
        [
          "**Итог по выборке** — _предварительный_:",
          "",
          "- подтверждено: 31",
          "- расхождения: 9",
          "- молчат: 8",
          "",
          "```",
          "Вектор   1 240 000   1 180 000   -60 000",
          "Альфа      310 500     310 500         0",
          "```",
          "",
          "Методика: https://example.com/metodika-vyborki",
        ].join("\n"),
      ),
  },
  weird: {
    about: "неудобный текст: слово без пробелов, одни эмодзи, пустые строки, арабский",
    async run(room) {
      await pavel.say(room.id, `Ссылка:${"оченьдлинноесловобезпробелов".repeat(12)}`);
      await sleep(400);
      await pavel.say(room.id, "🔥🔥🔥🎉✅");
      await sleep(400);
      await marina.say(room.id, "первая строка\n\n\n\n\nпосле пяти пустых");
      await sleep(400);
      await marina.say(room.id, "клиент из Дубая пишет: مرحبا، هل التقرير جاهز؟");
    },
  },
  spread: {
    about: "по реплике во все чаты сразу — числа в панели и в свёрнутых проектах",
    async run(_room, all) {
      for (const one of all) {
        await pick([marina, pavel]).say(one.id, pick(SHORT));
        await sleep(200);
      }
    },
  },
  drip: {
    about: "медленный разговор: 6 реплик раз в 5–10 с — живое появление",
    async run(room) {
      const talk = [
        [marina, "Паш, ты акт сверки получил?"],
        [pavel, "получил, но там подписи нет"],
        [marina, "а скан с печатью?"],
        [pavel, "только pdf без печати"],
        [marina, "тогда запрашиваем оригинал"],
        [pavel, "ок, пишу им"],
      ];
      for (const [who, text] of talk) {
        await who.say(room.id, text);
        await sleep(5000 + Math.random() * 5000);
      }
    },
  },
  pin: {
    about: "важное закрепляется — полоска закреплённого сверху",
    async run(room) {
      const said = await pavel.say(
        room.id,
        "📌 Срок сдачи отчёта клиенту — 15 октября, без переносов",
      );
      await sleep(1000);
      await pavel.json("POST", `/v1/messages/${said.id}/pin`);
    },
  },
  forward: {
    about: "пересылка твоей реплики из другого чата — «переслано от»",
    async run(room, all) {
      const other = all.find((one) => one.id !== room.id);
      const mine = other ? await lastOf(other, OWNER) : null;
      if (!mine) return marina.say(room.id, "хотела переслать твоё из другого чата, но там пусто");
      await marina.say(room.id, mine.body, { forwardedFromId: mine.id });
    },
  },
};

/* ── выбор: названные или давно не бывшие ───────────────────────────────── */

if (process.argv.includes("--list")) {
  for (const [name, one] of Object.entries(SCENARIOS))
    console.log(`${name.padEnd(9)} ${one.about}`);
  process.exit(0);
}

const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
const asked = process.argv.slice(2).filter((one) => !one.startsWith("--"));
for (const name of asked) if (!SCENARIOS[name]) throw new Error(`нет сценария «${name}» (--list)`);
const chosen =
  asked.length > 0
    ? asked
    : Object.keys(SCENARIOS)
        .sort((a, b) => (log[a]?.at ?? 0) - (log[b]?.at ?? 0) || Math.random() - 0.5)
        .slice(0, 2);

const all = await rooms();
for (const name of chosen) {
  const room = pick(all);
  await SCENARIOS[name].run(room, all);
  log[name] = { at: Date.now(), count: (log[name]?.count ?? 0) + 1, room: room.title };
  console.log(`✓ ${name} → «${room.title}»: ${SCENARIOS[name].about}`);
}
writeFileSync(LOG, JSON.stringify(log, null, 2));
