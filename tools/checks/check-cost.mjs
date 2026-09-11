#!/usr/bin/env node
/**
 * Гейт цены: горячий запрос не читает лишнего.
 *
 * ЗАЧЕМ. Все восемнадцать наших гейтов решаются ЧТЕНИЕМ репозитория:
 * размер файла, мёртвый код, цвет из токена, честность коммита. Цена
 * запроса чтением не решается — её видно только на запущенной системе
 * и только на данных известного объёма. Этого рода прибора у нас
 * не было, и он был нужен: панель месяц читала всю переписку канала,
 * чтобы узнать, когда в нём говорили в последний раз (Д-30). Тесты
 * этого не видели по построению — в их базе у канала три сообщения,
 * и «прочитать все три» неотличимо от «прочитать одну».
 *
 * ⚠️ МЕРИМ СТРОКИ, А НЕ ВРЕМЯ. Время зависит от соседа по машине: такой
 * гейт краснел бы на исправном коде, стал бы мигающим и через неделю был
 * бы отключён — прямой закон Гудхарта, метрика вместо цели.
 *
 * ⚠️ И МЕРИМ ПРИРОСТ, А НЕ АБСОЛЮТНОЕ ЧИСЛО. Первая редакция сравнивала
 * с постоянной в реестре — и покраснела на исправном коде в первый же
 * час: 79 строк вместо 41. Причина не в запросе, а в том, что план
 * выбирает планировщик, а он смотрит на статистику ВСЕЙ базы. На стенде
 * после сотни прогонов она другая, чем на чистой машине конвейера, —
 * то есть постоянная стерегла не наш код, а содержимое базы рядом.
 *
 * Свойство, которое надо стеречь, называется иначе: ЦЕНА ПАНЕЛИ
 * НЕ ЗАВИСИТ ОТ ОБЪЁМА ПЕРЕПИСКИ. Его и проверяем — двумя замерами
 * на разных объёмах. Читает панель по индексу — разница будет в единицы
 * строк; читает обходом — разница будет в десятки тысяч. Такое сравнение
 * не зависит ни от соседней базы, ни от версии планировщика.
 *
 * ⚠️ МЕРИМ НАСТОЯЩИЙ ЗАПРОС, А НЕ ЕГО КОПИЮ. SQL берётся у самого
 * `listConversationsFor` через `.toSQL()`. Копия SQL в этом файле
 * рассохлась бы в первый же день, и гейт стерёг бы запрос, которого
 * в продукте нет, — то есть был бы хуже, чем никакой.
 *
 * ⚠️ ВСЁ В ТРАНЗАКЦИИ С ОТКАТОМ. Гейт сеет пятьдесят тысяч реплик, чтобы
 * разница между «по индексу» и «обходом» стала видна. После отката база
 * ровно та же, что была: гонять его можно и на стенде владельца.
 *
 * Требует поднятого стека, поэтому живёт рядом с `make test`, а не
 * в `make check`: быстрые проверки обязаны оставаться быстрыми.
 */
import { readFileSync } from "node:fs";

/**
 * Строка подключения СНАРУЖИ контейнера.
 *
 * ⚠️ ТА, ЧТО В `.env`, СЮДА НЕ ГОДИТСЯ. Там адрес внутри сети docker
 * (`postgres:5432`) — им ходят api и мигратор, живущие в контейнерах.
 * Гейт запускается с машины, как приёмочные тесты, и ему нужен
 * опубликованный порт. Собираем строку из тех же кусков `.env`,
 * а не заводим вторую переменную: два ответа на «где база» однажды
 * разойдутся.
 */
function connectionString() {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  const port = env.POSTGRES_HOST_PORT ?? "5432";
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/${env.POSTGRES_DB}`;
}

const DATABASE_URL = process.env.COST_DATABASE_URL ?? connectionString();

// ⚠️ ПЕРЕМЕННАЯ СТАВИТСЯ ДО ЗАГРУЗКИ СЛОЯ БАЗЫ. `platform/db.js` читает
// её на импорте; статический импорт выполнился бы раньше этой строки.
process.env.DATABASE_URL = DATABASE_URL;
const { listConversationsFor } = await import("../../backend/dist/kernel/talk/repo.js");
/**
 * ⚠️ ПУЛ БЕРЁТСЯ У САМОГО СЛОЯ БАЗЫ, А НЕ ЗАВОДИТСЯ СВОЙ. Свой означал бы
 * вторую зависимость от драйвера и второй ответ на вопрос «как мы ходим
 * в базу» — а гейт мёртвого кода поймал это в первую же минуту.
 */
const { db, pool } = await import("../../backend/dist/platform/db.js");

/**
 * Два объёма для сравнения. Малый — чтобы было с чем сравнивать;
 * большой — чтобы обход переписки стал виден издалека.
 */
const SMALL = 5_000;
const LARGE = 50_000;

/**
 * Сколько строк разрешено прибавить при десятикратном росте переписки.
 *
 * Не ноль: план может дрогнуть на единицы строк от статистики. Но и не
 * сотня: обход канала дал бы прирост в сорок пять тысяч, и его не спрячет
 * никакой запас. Храповик крутится только вниз.
 */
const RATCHET = "tools/ratchets/panel-rows.txt";

/**
 * Сумма прочитанных строк по всему плану.
 *
 * Складываем по каждому узлу выданные строки И ОТБРОШЕННЫЕ фильтром:
 * столько Postgres действительно потрогал, чтобы ответить. Верхнее число
 * одного узла обмануло бы — обход прячется внутри.
 *
 * ⚠️ ОТБРОШЕННЫЕ СЧИТАЮТСЯ, И ЭТО ИСПРАВЛЕНИЕ СЛЕПОТЫ. Первая редакция
 * брала только `Actual Rows`, а это строки ПОСЛЕ фильтра. Обход индекса,
 * который читал пятьдесят тысяч своих реплик и выбрасывал их условием
 * «не свои», выглядел нулём — гейт был зелёным на стенде и покраснел
 * только в чистой базе конвейера, где планировщик выбрал обход таблицы.
 * Числа — на узел за один проход, как и `Actual Rows`; проходов — `Loops`.
 */
const DISCARDED = [
  "Rows Removed by Filter",
  "Rows Removed by Index Recheck",
  "Rows Removed by Join Filter",
];

function planRows(node) {
  const touched = DISCARDED.reduce(
    (total, key) => total + (node[key] ?? 0),
    node["Actual Rows"] ?? 0,
  );
  const own = touched * (node["Actual Loops"] ?? 1);
  const children = [...(node.Plans ?? []), ...(node.Subplans ?? [])];
  return children.reduce((total, one) => total + planRows(one), own);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Своё пространство: гейт не должен зависеть от того, что кто-то
    // завёл руками, и не должен трогать чужое.
    const { rows: workspaces } = await client.query(
      `INSERT INTO workspace (name) VALUES ('замер цены') RETURNING id`,
    );
    const wid = workspaces[0].id;
    // Человек без учётной записи базой запрещён (`participant_account_matches_kind_ck`):
    // «человек» и «есть чем войти» — одно и то же утверждение, и база держит
    // его сама. Заводим и запись, и участника.
    const { rows: accounts } = await client.query(
      `INSERT INTO account (email, password_hash) VALUES ($1, 'замер') RETURNING id`,
      [`cost-${Date.now()}@example.test`],
    );
    const { rows: people } = await client.query(
      `INSERT INTO participant (workspace_id, account_id, display_name, role, kind)
       VALUES ($1, $2, 'мерящий', 'owner', 'human') RETURNING id`,
      [wid, accounts[0].id],
    );
    const pid = people[0].id;
    const { rows: conversations } = await client.query(
      `INSERT INTO conversation (workspace_id, kind, title) VALUES ($1, 'channel', 'Замер')
       RETURNING id`,
      [wid],
    );
    const cid = conversations[0].id;
    await client.query(
      `INSERT INTO conversation_member (conversation_id, participant_id, workspace_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [cid, pid, wid],
    );
    const { sql, params } = listConversationsFor(db, pid, wid).toSQL();

    /** Досеять переписку до нужного объёма и померить панель. */
    const measure = async (from, to) => {
      await client.query(
        `INSERT INTO message (workspace_id, conversation_id, author_participant_id, body,
                              client_msg_id, seq, updated_seq, created_at)
         SELECT $1, $2, $3, 'замер ' || g, gen_random_uuid(), g, g,
                now() - (g || ' seconds')::interval
         FROM generate_series($4::int, $5::int) g`,
        [wid, cid, pid, from, to],
      );
      await client.query("ANALYZE message");
      const { rows: plan } = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
      return planRows(plan[0]["QUERY PLAN"][0].Plan);
    };

    const onSmall = await measure(1, SMALL);
    const onLarge = await measure(SMALL + 1, LARGE);
    const growth = onLarge - onSmall;

    await client.query("ROLLBACK");

    const limit = Number(readFileSync(RATCHET, "utf8").trim());
    if (!Number.isFinite(limit)) {
      console.error(`${RATCHET}: не число`);
      process.exit(1);
    }

    if (growth > limit) {
      console.error(
        [
          "",
          "Цена панели растёт с объёмом переписки.",
          "",
          `  на ${SMALL} репликах — ${onSmall} строк`,
          `  на ${LARGE} репликах — ${onLarge} строк`,
          `  прирост ${growth} при разрешённых ${limit}`,
          "",
          "  ПОЧИНИТЬ: посмотри план запроса и найди узел, который читает всё.",
          "  Так уже было: свежесть канала считалась обходом всей переписки,",
          "  потому что индекса под MAX(created_at) нет (Д-30).",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }

    console.log(
      `цена панели: ${onSmall} строк на ${SMALL} репликах, ${onLarge} на ${LARGE} — ` +
        `прирост ${growth} при разрешённых ${limit}, от объёма не зависит — OK`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
