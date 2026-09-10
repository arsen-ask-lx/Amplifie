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
 * ⚠️ МЕРИМ СТРОКИ, А НЕ ВРЕМЯ, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ЗДЕСЬ. Время
 * зависит от соседа по машине: такой гейт краснел бы на исправном коде,
 * стал бы мигающим и через неделю был бы отключён — а это прямой закон
 * Гудхарта, метрика вместо цели. Число прочитанных строк детерминировано:
 * оно зависит только от плана запроса, то есть от нашего кода.
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
function строкаПодключения() {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  const порт = env.POSTGRES_HOST_PORT ?? "5432";
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${порт}/${env.POSTGRES_DB}`;
}

const URL_БАЗЫ = process.env.COST_DATABASE_URL ?? строкаПодключения();

// ⚠️ ПЕРЕМЕННАЯ СТАВИТСЯ ДО ЗАГРУЗКИ СЛОЯ БАЗЫ. `platform/db.js` читает
// её на импорте; статический импорт выполнился бы раньше этой строки.
process.env.DATABASE_URL = URL_БАЗЫ;
const { listConversationsFor } = await import("../../backend/dist/kernel/talk/repo.js");
/**
 * ⚠️ ПУЛ БЕРЁТСЯ У САМОГО СЛОЯ БАЗЫ, А НЕ ЗАВОДИТСЯ СВОЙ. Свой означал бы
 * вторую зависимость от драйвера и второй ответ на вопрос «как мы ходим
 * в базу» — а гейт мёртвого кода поймал это в первую же минуту.
 */
const { db, pool } = await import("../../backend/dist/platform/db.js");

/** Сколько реплик сеем. Ниже этого разница между планами не видна. */
const РЕПЛИК = 50_000;

/** Где лежит разрешённое число. Храповик крутится только вниз. */
const ХРАПОВИК = "tools/ratchets/panel-rows.txt";

/**
 * Сумма прочитанных строк по всему плану.
 *
 * Складываем `Actual Rows` каждого узла: именно столько строк Postgres
 * действительно потрогал, чтобы ответить. Верхнее число одного узла
 * обмануло бы — обход прячется внутри.
 */
function строкПлана(node) {
  const свои = (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 1);
  const дети = [...(node.Plans ?? []), ...(node["Subplans"] ?? [])];
  return дети.reduce((всего, one) => всего + строкПлана(one), свои);
}

async function main() {
  const клиент = await pool.connect();
  try {
    await клиент.query("BEGIN");

    // Своё пространство: гейт не должен зависеть от того, что кто-то
    // завёл руками, и не должен трогать чужое.
    const { rows: пространства } = await клиент.query(
      `INSERT INTO workspace (name) VALUES ('замер цены') RETURNING id`,
    );
    const wid = пространства[0].id;
    // Человек без учётной записи базой запрещён (`participant_account_matches_kind_ck`):
    // «человек» и «есть чем войти» — одно и то же утверждение, и база держит
    // его сама. Заводим и запись, и участника.
    const { rows: записи } = await клиент.query(
      `INSERT INTO account (email, password_hash) VALUES ($1, 'замер') RETURNING id`,
      [`cost-${Date.now()}@example.test`],
    );
    const { rows: люди } = await клиент.query(
      `INSERT INTO participant (workspace_id, account_id, display_name, role, kind)
       VALUES ($1, $2, 'мерящий', 'owner', 'human') RETURNING id`,
      [wid, записи[0].id],
    );
    const pid = люди[0].id;
    const { rows: разговоры } = await клиент.query(
      `INSERT INTO conversation (workspace_id, kind, title) VALUES ($1, 'channel', 'Замер')
       RETURNING id`,
      [wid],
    );
    const cid = разговоры[0].id;
    await клиент.query(
      `INSERT INTO conversation_member (conversation_id, participant_id, workspace_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [cid, pid, wid],
    );
    await клиент.query(
      `INSERT INTO message (workspace_id, conversation_id, author_participant_id, body,
                            client_msg_id, seq, updated_seq, created_at)
       SELECT $1, $2, $3, 'замер ' || g, gen_random_uuid(), g, g, now() - (g || ' seconds')::interval
       FROM generate_series(1, $4) g`,
      [wid, cid, pid, РЕПЛИК],
    );
    await клиент.query("ANALYZE message");

    const { sql, params } = listConversationsFor(db, pid).toSQL();
    const { rows: план } = await клиент.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
    const строк = строкПлана(план[0]["QUERY PLAN"][0].Plan);

    await клиент.query("ROLLBACK");

    const предел = Number(readFileSync(ХРАПОВИК, "utf8").trim());
    if (!Number.isFinite(предел)) {
      console.error(`${ХРАПОВИК}: не число`);
      process.exit(1);
    }

    if (строк > предел) {
      console.error(
        `\nПанель читает ${строк} строк на канале в ${РЕПЛИК} реплик — разрешено ${предел}.\n\n` +
          "  ПОЧИНИТЬ: посмотри план запроса и найди узел, который читает всё.\n" +
          "  Так уже было: свежесть канала считалась обходом всей переписки,\n" +
          "  потому что индекса под `MAX(created_at)` нет (Д-30).\n\n" +
          `  Показать план: EXPLAIN (ANALYZE) на засеянной базе.\n`,
      );
      process.exit(1);
    }

    if (строк < предел) {
      console.error(
        `\nПанель читает ${строк} строк — меньше, чем ${предел} в реестре.\n\n` +
          `  ПОЧИНИТЬ: запиши новое число в ${ХРАПОВИК}.\n` +
          "  Иначе храповик разрешит вернуть обход обратно, и работа пропадёт.\n",
      );
      process.exit(1);
    }

    console.log(
      `цена панели: ${строк} строк на канале в ${РЕПЛИК} реплик — столько же, сколько в реестре, роста нет — OK`,
    );
  } finally {
    клиент.release();
    await pool.end();
  }
}

await main();
