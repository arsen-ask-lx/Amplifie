#!/usr/bin/env node
/**
 * Засев отдельной базы для замера поиска (task-100, шаг 0).
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ БАЗА. Поиск меряется на объёме, которого на стенде нет
 * и не должно быть: миллионы реплик в рабочей базе владельца сломали бы
 * ему стенд и все прочие замеры. База `amplifie_search` живёт в том же
 * контейнере Postgres — тот же образ, та же локаль, те же миграции.
 * Удалять её — только с разрешения владельца.
 *
 * ⚠️ ТЕКСТ НЕ СЛУЧАЙНЫЙ ШУМ, А ПОХОЖИЙ НА ПЕРЕПИСКУ. Главная ловушка поиска —
 * ЧАСТОЕ слово (разбор, раздел 2): на шуме из уникальных строк её не видно.
 * Поэтому слова берутся из словаря с перекосом частоты (частые правда
 * частые), «сегодня» стоит в каждом десятом теле, редкое «лиственница» —
 * в одном теле из пула, упоминания и код — как в рабочем чате.
 *
 * ⚠️ 30% РЕПЛИК — В ЗАКРЫТЫХ ЧАТАХ. Поиск отбрасывает невидимое построчно;
 * без заметной доли закрытого эта цена не видна.
 *
 * ⚠️ ТЯЖЁЛОЕ ДЕЛАЕТ БАЗА, А НЕ СКРИПТ. Реплики вставляются `INSERT … SELECT
 * generate_series` пачками: гонять миллионы строк через драйвер — это часы
 * и замер драйвера, а не базы.
 *
 * Запуск: make search-seed (стенд поднят: make up)
 * Объём: MESSAGES=1000000 make search-seed
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import { hostDatabaseUrl } from "./host-database.mjs";

/** Имя базы замера: разные словари — разные базы, прежний засев не трогаем. */
const DATABASE = process.env.SEARCH_DATABASE ?? "amplifie_search";
const MESSAGES = Number(process.env.MESSAGES ?? 1_000_000);
/**
 * Сколько людей и чатов. Числа задаются снаружи ради второго замера —
 * поиска ВНУТРИ одного чата (task-106): там нужна база, где реплики
 * лежат не поровну по трём тысячам чатов, а горой в одном.
 *
 * ⚠️ ЗАКРЫТЫХ ЧАТОВ ВСЕГДА ХОТЯ БЫ ОДИН: три реплики из десяти уходят
 * в закрытый по номеру, и на пустом списке засев упал бы на `NULL`.
 */
const PEOPLE = Number(process.env.PEOPLE ?? 5_000);
const OPEN = Number(process.env.OPEN ?? 3_000);
const CLOSED = Math.max(1, Number(process.env.CLOSED ?? 500));
const THREADS = Number(process.env.THREADS ?? 300);
/** Участников закрытого чата. */
const CLOSED_MEMBERS = 20;
/** Разных тел реплик: пул, из которого реплики берут текст. */
const BODIES = Number(process.env.BODIES ?? 200_000);
/**
 * Длинный хвост словаря: редкие слова, собранные из слогов.
 *
 * ⚠️ БЕЗ ХВОСТА ЗАМЕР ВРЁТ ИМЕННО О ЛОВУШКЕ. Первый засев (180 слов) положил
 * в статистику Postgres почти весь словарь, и редкое слово оценивалось
 * заглушкой «0,5% строк» — планировщик шёл обходом по номеру и читал весь
 * миллион. В живой переписке слов десятки тысяч, и оценка редких другая.
 */
const TAIL = Number(process.env.TAIL_WORDS ?? 30_000);
/** Реплик за один `INSERT`. */
const CHUNK = 250_000;

/**
 * Словарь: частые слова переписки первыми. Формы одного слова нарочно
 * разные — поиск по основе обязан их находить, а по началу — нет.
 */
const WORDS = [
  "и",
  "в",
  "не",
  "на",
  "что",
  "это",
  "по",
  "как",
  "так",
  "мы",
  "вы",
  "да",
  "нет",
  "надо",
  "задача",
  "договор",
  "договоры",
  "договора",
  "договором",
  "срок",
  "сроки",
  "смета",
  "сметы",
  "объект",
  "объекта",
  "подрядчик",
  "подрядчики",
  "подрядчика",
  "оплата",
  "оплату",
  "счёт",
  "счета",
  "проект",
  "проекта",
  "план",
  "плана",
  "встреча",
  "встречу",
  "завтра",
  "вчера",
  "неделя",
  "неделю",
  "клиент",
  "клиента",
  "документ",
  "документы",
  "согласовать",
  "согласовали",
  "отправил",
  "отправила",
  "проверить",
  "проверил",
  "сделать",
  "сделали",
  "готово",
  "готов",
  "ошибка",
  "ошибку",
  "релиз",
  "релиза",
  "сборка",
  "сборку",
  "тест",
  "тесты",
  "база",
  "базы",
  "запрос",
  "запросы",
  "ответ",
  "ответил",
  "вопрос",
  "вопросы",
  "бюджет",
  "бюджета",
  "материал",
  "материалы",
  "поставка",
  "поставку",
  "склад",
  "склада",
  "ёлка",
  "ёлки",
  "всё",
  "ещё",
  "deploy",
  "deployed",
  "release",
  "review",
  "merge",
  "branch",
  "commit",
  "fix",
  "bug",
  "issue",
  "server",
  "client",
  "database",
  "index",
  "query",
  "api",
  "frontend",
  "backend",
  "pipeline",
  "invoice",
  "contract",
  "budget",
  "meeting",
  "tomorrow",
  "today",
  "done",
  "бетон",
  "арматура",
  "фасад",
  "кровля",
  "окна",
  "двери",
  "электрика",
  "сантехника",
  "вентиляция",
  "отопление",
  "фундамент",
  "стены",
  "перекрытие",
  "чертёж",
  "чертежи",
  "акт",
  "акты",
  "приёмка",
  "приёмку",
  "замечания",
  "замечание",
  "исправить",
  "исправили",
  "перенести",
  "перенесли",
  "утвердить",
  "утвердили",
  "цена",
  "цены",
  "скидка",
  "скидку",
  "доставка",
  "доставку",
];

function run(sql) {
  // Создать базу нельзя внутри транзакции и нельзя из базы, которой ещё нет:
  // идём через psql в контейнере к рабочей базе.
  return execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "amplifie",
      "-d",
      "amplifie",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

async function timed(label, work) {
  const started = performance.now();
  const result = await work();
  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(1)} с`);
  return result;
}

async function main() {
  if (!Number.isInteger(MESSAGES) || MESSAGES <= 0)
    throw new Error(`MESSAGES: не число — ${MESSAGES}`);

  // ⚠️ ЗАСЕВ ВОЗОБНОВЛЯЕТСЯ, А НЕ НАЧИНАЕТСЯ ЗАНОВО. Упавший на середине
  // засев не требует сносить базу (удаление — решение владельца): каждый
  // этап проверяет, сделан ли он, а реплики дописываются с места остановки.
  const exists = run(`select 1 from pg_database where datname = '${DATABASE}'`);
  if (exists !== "1") run(`create database ${DATABASE}`);

  const url = hostDatabaseUrl(DATABASE);
  await timed("миграции", async () => {
    execFileSync("node", ["backend/dist/migrate.js"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
  });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const done = async (sql) => (await client.query(sql)).rows[0]?.done === true;
    if (!(await done("select count(*) > 0 as done from workspace"))) {
      await timed("люди и чаты", () => people(client));
    }
    // Двумя запросами: Postgres разбирает запрос целиком и падает на таблице,
    // которой ещё нет, даже если первое условие уже ложно.
    const hasBodies =
      (await done("select to_regclass('seed_body') is not null as done")) &&
      (await done("select exists (select 1 from seed_body) as done"));
    if (!hasBodies) {
      await timed("тела реплик", () => bodies(client));
    }
    const { rows: last } = await client.query(
      "select coalesce(max(seq), 0)::int as seq from message",
    );
    for (let from = last[0].seq + 1; from <= MESSAGES; from += CHUNK) {
      const to = Math.min(MESSAGES, from + CHUNK - 1);
      await timed(`реплики ${from}–${to}`, () => messages(client, from, to));
    }
    await client.query(`update workspace set last_seq = $1`, [MESSAGES]);
    await timed("ANALYZE", () => client.query("analyze"));
    const { rows } = await client.query(
      `select pg_size_pretty(pg_database_size(current_database())) as size,
              pg_size_pretty(pg_total_relation_size('message')) as messages`,
    );
    console.log(
      `готово: ${MESSAGES} реплик; база ${rows[0].size}, таблица реплик с индексами ${rows[0].messages}`,
    );
  } finally {
    await client.end();
  }
}

/** Пространство, люди, открытые и закрытые чаты, ветки, членство. */
async function people(client) {
  await client.query("begin");
  await client.query(`insert into workspace (name) values ('замер поиска')`);
  await client.query(
    `insert into account (email, password_hash)
     select 'search-' || g || '@example.test', 'замер' from generate_series(1, $1) g`,
    [PEOPLE],
  );
  await client.query(
    `insert into participant (workspace_id, account_id, display_name, role, kind)
     select w.id, a.id, 'Человек ' || a.email, case when a.email = 'search-1@example.test' then 'owner' else 'member' end, 'human'
     from account a, workspace w`,
  );
  await client.query(
    `insert into conversation (workspace_id, kind, title, visibility)
     select w.id, 'channel', 'Открытый ' || g, 'workspace' from workspace w, generate_series(1, $1) g`,
    [OPEN],
  );
  await client.query(
    `insert into conversation (workspace_id, kind, title, visibility)
     select w.id, 'channel', 'Закрытый ' || g, 'private' from workspace w, generate_series(1, $1) g`,
    [CLOSED],
  );
  if (THREADS > 0) {
    await client.query(
      `insert into conversation (workspace_id, kind, title, parent_id)
       select c.workspace_id, 'thread', 'Ветка ' || c.title, c.id
       from (select * from conversation where visibility = 'workspace' order by title limit $1) c`,
      [THREADS],
    );
  }
  /**
   * Членство закрытых. Человек 1 — в 200 закрытых, человек 2 — ни в одном:
   * это два крайних зрителя замера. Остальные места — по кругу.
   */
  await client.query(
    `with closed as (
       select id, workspace_id, row_number() over (order by title) as n
       from conversation where visibility = 'private'
     ), people as (
       select id, row_number() over (order by display_name) as n from participant
     ), numbered as (
       select c.id as conversation_id, c.workspace_id, k, c.n
       from closed c, generate_series(0, $1 - 1) k
     )
     insert into conversation_member (conversation_id, participant_id, workspace_id, role)
     select distinct on (x.conversation_id, x.participant_id) x.conversation_id, x.participant_id, x.workspace_id, x.role
     from (
       select n.conversation_id, p.id as participant_id, n.workspace_id,
              case when n.k = 0 then 'owner' else 'member' end as role
       from numbered n
       join people p on p.n = 3 + ((n.n * 7 + n.k * 13) % ($2 - 2))
       union all
       select c.id, p.id, c.workspace_id, 'member'
       from closed c join people p on p.n = 1 where c.n <= 200
     ) x`,
    [CLOSED_MEMBERS, PEOPLE],
  );
  await client.query("commit");
}

/**
 * Пул тел. Слово выбирается с перекосом: номер в словаре — показатель
 * случайного числа, поэтому первые слова частые, последние редкие.
 */
async function bodies(client) {
  await client.query("begin");
  await client.query("drop table if exists seed_word, seed_body");
  await client.query(`create table seed_word (rank int primary key, word text not null)`);
  await client.query(
    `insert into seed_word select ord::int, word from unnest($1::text[]) with ordinality as t(word, ord)`,
    [WORDS],
  );
  // Хвост: три слога на слово, номер слова — в системе счисления по числу слогов.
  await client.query(
    `insert into seed_word
     select $2 + i, s[1 + i % 40] || s[1 + (i / 40) % 40] || s[1 + (i / 1600) % 40]
     from generate_series(1, $1) i,
          (select array['ба','ве','ги','до','жу','за','ки','ло','му','не',
                        'пи','ро','су','та','фе','хи','цо','чу','ша','щё',
                        'бор','вил','гам','дон','жек','зор','кит','лам','мир','нос',
                        'пар','рык','сон','тур','фил','хор','цап','чин','шум','ять'] as s) syllables`,
    [TAIL, WORDS.length],
  );
  await client.query(`create table seed_body (id int primary key, body text not null)`);
  await client.query(
    `insert into seed_body (id, body)
     select b,
       concat_ws(' ',
         (select string_agg(w.word, ' ' order by k)
            from generate_series(1, 5 + (b % 14)) k
            join seed_word w on w.rank = least($2::int, 1 + floor(exp(ln($2::float) * ((hashint4(b * 31 + k) & 1048575) / 1048576.0)))::int)),
         case when b % 10 = 0 then 'сегодня' end,
         case when b = 777 then 'лиственница' end,
         case when b % 50 = 0 then '[Анна](@3fa85f64-5717-4562-b3fc-2c963f66afa6)' end,
         case when b % 40 = 0 then '\`код_' || b || '\`' end)
     from generate_series(1, $1) b`,
    [BODIES, WORDS.length + TAIL],
  );
  await client.query("commit");
}

/**
 * Реплики пачкой. Чат, автор и тело — от номера реплики хешем, а не
 * `random()`: засев повторяем, и два прогона одного объёма дают одну базу.
 * Три из десяти — в закрытые чаты. Время — равномерно за год.
 */
async function messages(client, from, to) {
  await client.query(
    `with ids as (
       select
         (select array_agg(id order by title) from conversation where visibility = 'workspace' or parent_id is not null) as open_ids,
         (select array_agg(id order by title) from conversation where visibility = 'private') as closed_ids,
         (select array_agg(id order by display_name) from participant) as people_ids,
         (select id from workspace limit 1) as wid
     )
     insert into message (workspace_id, conversation_id, author_participant_id, body, client_msg_id, seq, updated_seq, created_at)
     select ids.wid,
            case when g % 10 < 3
              then ids.closed_ids[1 + (hashint4(g) & 2147483647) % cardinality(ids.closed_ids)]
              else ids.open_ids[1 + (hashint4(g) & 2147483647) % cardinality(ids.open_ids)]
            end,
            ids.people_ids[1 + (hashint4(g * 3) & 2147483647) % cardinality(ids.people_ids)],
            sb.body, gen_random_uuid(), g, g,
            now() - interval '365 days' + (g::float / $3) * interval '365 days'
     from ids, generate_series($1::int, $2::int) g
     join seed_body sb on sb.id = 1 + (hashint4(g * 7) & 2147483647) % $4`,
    [from, to, MESSAGES, BODIES],
  );
}

await main();
