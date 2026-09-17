#!/usr/bin/env node
/**
 * Замер поиска по сообщениям на засеянной базе (task-100, шаг 0).
 *
 * ЧТО МЕРЯЕТ, И ВСЁ ЭТО — ДО КОДА ПРОДУКТА:
 * 1. накат миграции поиска (`0027_message_search.sql`) с заполнением таблицы
 *    из уже засеянных реплик — время и размер;
 * 2. какой путь выбирает сам планировщик на лесенке частот — от слова
 *    в десятке реплик до слова в каждой десятой — при двух точностях
 *    статистики, для зрителя в 200 закрытых чатах и зрителя без закрытых:
 *    путь, прочитано строк и время, по два прогона;
 * 3. цену триггера на записи (WRITES=1): одновременные вставки с ним и без.
 *
 * ⚠️ ПОЧЕМУ ЛЕСЕНКА, А НЕ ДВА СЛОВА. Первый замер (1 млн, словарь 180 слов)
 * показал: обход по номеру дёшев для частого слова и читает всё для редкого,
 * а выборка из индекса слов — наоборот. Ступенчатое окно и «сперва
 * посчитать» не помогли — планировщик ошибался в оценке редкого слова,
 * потому что в тощем словаре оно не попадало в статистику. Вопрос теперь
 * один: выбирает ли планировщик верный путь на живом словаре сам.
 *
 * ⚠️ ЗАПРОС ЗДЕСЬ — КАНДИДАТ, А НЕ КОПИЯ ПРОДУКТА. Продуктового запроса
 * ещё нет: замер выбирает его форму. Права — то же выражение, что `canSee`
 * в `talk/repo.ts`; когда запрос появится в продукте, гейт цены будет мерить
 * уже его `.toSQL()`.
 *
 * ⚠️ ЗАПИСЬ ЗДЕСЬ — ПРИКИДКА. Настоящая отправка — дверь, сессия и одиннадцать
 * запросов; здесь только «номер + вставка» под тем же замком строки
 * пространства. Первый замер разбросал прогоны вдвое — разница с триггером
 * и без в таком шуме не видна. Настоящий потолок — `make write-ceiling`.
 *
 * Запуск: make search-measure (после make search-seed)
 * База: SEARCH_DATABASE=amplifie_search_tail make search-measure
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { hostDatabaseUrl } from "./host-database.mjs";
import { planRows } from "./plan-rows.mjs";

/** Та же база, что засеял `search-seed`: имя — той же переменной. */
const URL = hostDatabaseUrl(process.env.SEARCH_DATABASE ?? "amplifie_search");
/** Предел выдачи: страница 20 и одна сверх — «есть ли ещё». */
const PAGE = 21;
/** Точности статистики столбца: по умолчанию Postgres и в десять раз выше. */
const STATISTICS = (process.env.STATISTICS ?? "100,1000").split(",").map(Number);
/** Места в словаре засева: от частого к редкому хвосту. */
const LADDER = [20, 200, 2_000, 10_000, 25_000];

/** Единственное правило видимости — то же выражение, что `canSee` в `talk/repo.ts`. */
const VISIBLE = `EXISTS (
  SELECT 1 FROM conversation AS root
  WHERE root.id = COALESCE(c.parent_id, c.id)
    AND root.deleted_at IS NULL
    AND (
      (root.visibility = 'workspace' AND root.workspace_id = (
        SELECT asker.workspace_id FROM participant AS asker WHERE asker.id = $2
      ))
      OR EXISTS (
        SELECT 1 FROM conversation_member AS m
        WHERE m.conversation_id = root.id AND m.participant_id = $2
      )
    )
)`;

const SEARCH = `SELECT s.message_id, s.seq
  FROM message_search s
  JOIN message m ON m.id = s.message_id AND m.deleted_at IS NULL
  JOIN conversation c ON c.id = s.conversation_id AND c.deleted_at IS NULL
  WHERE s.workspace_id = $1
    AND s.doc @@ $3::tsquery
    AND ${VISIBLE}
  ORDER BY s.seq DESC
  LIMIT ${PAGE}`;

/** Слова запроса → tsquery тем же правилом, что обещает план. */
async function queryOf(client, text) {
  const words = text
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2)
    .slice(0, 8);
  const parts = words.map(
    (_, at) => `(to_tsquery('simple', $${at * 2 + 1}) || to_tsquery('russian', $${at * 2 + 2}))`,
  );
  const params = words.flatMap((word) => [`${word}:*`, word]);
  const { rows } = await client.query(`SELECT (${parts.join(" && ")})::text AS q`, params);
  return rows[0].q;
}

/** Каким путём шёл план: обход по номеру или выборка из индекса слов. */
function pathOf(node) {
  if (node["Node Type"] === "Index Scan" && node["Index Name"]?.includes("seq")) return "номер";
  if (node["Node Type"] === "Bitmap Index Scan") return "слова";
  for (const child of node.Plans ?? []) {
    const found = pathOf(child);
    if (found) return found;
  }
  return null;
}

async function explain(client, sql, params) {
  const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const plan = rows[0]["QUERY PLAN"][0];
  return {
    ms: plan["Execution Time"],
    rows: Math.round(planRows(plan.Plan)),
    path: pathOf(plan.Plan) ?? "?",
  };
}

async function timed(label, work) {
  const started = performance.now();
  const result = await work();
  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(1)} с`);
  return result;
}

async function prepare(client) {
  // Схема — сама миграция 0027, а не её копия. Базы замера, засеянные
  // до неё, получают её здесь; уже получившие — пропускают.
  const { rows } = await client.query("SELECT to_regclass('message_search') IS NOT NULL AS ready");
  if (!rows[0].ready) {
    const migration = readFileSync("backend/migrations/0027_message_search.sql", "utf8");
    await timed("миграция поиска с заполнением и индексами", async () => {
      await client.query("BEGIN");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("COMMIT");
    });
  }
  const { rows: sizes } = await client.query(
    `SELECT (SELECT count(*) FROM message) AS messages,
            (SELECT count(*) FROM seed_word) AS words,
            pg_size_pretty(pg_total_relation_size('message')) AS message_size,
            pg_size_pretty(pg_relation_size('message_search')) AS search_table,
            pg_size_pretty(pg_relation_size('message_search_doc_idx')) AS gin,
            pg_size_pretty(pg_relation_size('message_search_workspace_seq_idx')) AS seq_idx,
            pg_size_pretty(pg_database_size(current_database())) AS database`,
  );
  console.log("размеры:", sizes[0]);
}

async function viewers(client) {
  const { rows } = await client.query(
    `SELECT p.id, count(m.conversation_id)::int AS closed
     FROM participant p LEFT JOIN conversation_member m ON m.participant_id = p.id
     GROUP BY p.id ORDER BY closed DESC`,
  );
  const most = rows[0];
  const none = rows.find((one) => one.closed === 0);
  if (!most || !none) throw new Error("не нашлось зрителей замера");
  return [
    { name: `в ${most.closed} закрытых`, id: most.id },
    { name: "без закрытых", id: none.id },
  ];
}

/** Слова лесенки и сколько реплик каждое на самом деле находит. */
async function ladder(client, wid) {
  const { rows } = await client.query(
    "SELECT rank, word FROM seed_word WHERE rank = ANY($1::int[]) ORDER BY rank",
    [LADDER],
  );
  // Начало слова — как набирает человек: два знака, начало частого и редкого.
  const tail = rows.at(-1)?.word ?? "";
  const words = [
    ...rows.map((one) => one.word),
    "сегодня",
    "договор срок",
    "до",
    "сег",
    tail.slice(0, 4),
  ];
  const out = [];
  for (const text of words) {
    const q = await queryOf(client, text);
    const { rows: hits } = await client.query(
      "SELECT count(*)::int AS n FROM message_search WHERE workspace_id = $1 AND doc @@ $2::tsquery",
      [wid, q],
    );
    out.push({ text, q, hits: hits[0].n });
  }
  return out;
}

async function searches(client) {
  const { rows } = await client.query("SELECT id FROM workspace LIMIT 1");
  const wid = rows[0].id;
  const words = await ladder(client, wid);
  const people = await viewers(client);
  const report = [];
  for (const target of STATISTICS) {
    await timed(`статистика ${target}`, async () => {
      await client.query(`ALTER TABLE message_search ALTER COLUMN doc SET STATISTICS ${target}`);
      await client.query("ANALYZE message_search");
    });
    for (const viewer of people) {
      for (const word of words) {
        for (const run of [1, 2]) {
          const got = await explain(client, SEARCH, [wid, viewer.id, word.q]);
          report.push({
            stats: target,
            viewer: viewer.name,
            query: word.text,
            hits: word.hits,
            run,
            path: got.path,
            ms: Math.round(got.ms),
            rows: got.rows,
          });
        }
      }
    }
  }
  console.table(report);
}

function percentile(sorted, share) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

/** Одновременные записи «номер + вставка» под замком пространства. */
async function writes(label) {
  const senders = 50;
  const each = 20;
  const pool = new pg.Pool({ connectionString: URL, max: senders });
  const took = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: senders }, async () => {
      const client = await pool.connect();
      try {
        for (let n = 0; n < each; n++) {
          const begun = performance.now();
          await client.query("BEGIN");
          const { rows } = await client.query(
            "UPDATE workspace SET last_seq = last_seq + 1 RETURNING id, last_seq",
          );
          await client.query(
            `INSERT INTO message (workspace_id, conversation_id, author_participant_id, body, client_msg_id, seq, updated_seq)
             SELECT $1, (SELECT id FROM conversation ORDER BY random() LIMIT 1),
                    (SELECT id FROM participant LIMIT 1),
                    (SELECT body FROM seed_body WHERE id = $3),
                    gen_random_uuid(), $2, $2`,
            // Номер тела — отсюда: `random()` в условии подзапроса считался
            // на каждую строку пула, и тело иногда не находилось вовсе.
            [rows[0].id, rows[0].last_seq, 1 + Math.floor(Math.random() * 50_000)],
          );
          await client.query("COMMIT");
          took.push(performance.now() - begun);
        }
      } finally {
        client.release();
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  await pool.end();
  took.sort((a, b) => a - b);
  console.log(
    `${label}: ${(took.length / seconds).toFixed(0)} зап/с, 0.5 — ${percentile(took, 0.5).toFixed(0)} мс, 0.99 — ${percentile(took, 0.99).toFixed(0)} мс`,
  );
}

async function main() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    await prepare(client);
    await searches(client);
    if (process.env.WRITES !== "1") return;
    for (const run of [1, 2]) {
      await writes(`запись с триггером, прогон ${run}`);
      await client.query("ALTER TABLE message DISABLE TRIGGER message_search_on_insert");
      try {
        await writes(`запись без триггера, прогон ${run}`);
      } finally {
        await client.query("ALTER TABLE message ENABLE TRIGGER message_search_on_insert");
      }
    }
  } finally {
    await client.end();
  }
}

await main();
