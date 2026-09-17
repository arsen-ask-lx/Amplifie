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
import { hostDatabaseUrl } from "../load/host-database.mjs";
import { planRows } from "../load/plan-rows.mjs";

// Строка подключения снаружи контейнера — одна на все замеры (`host-database.mjs`).
const DATABASE_URL = process.env.COST_DATABASE_URL ?? hostDatabaseUrl();

// ⚠️ ПЕРЕМЕННАЯ СТАВИТСЯ ДО ЗАГРУЗКИ СЛОЯ БАЗЫ. `platform/db.js` читает
// её на импорте; статический импорт выполнился бы раньше этой строки.
process.env.DATABASE_URL = DATABASE_URL;
const { listConversationsFor, listMessagesNewer, projectCountsFor, searchMessagesPage } =
  await import("../../backend/dist/kernel/talk/repo.js");
const { tsqueryOf } = await import("../../backend/dist/kernel/talk/tsquery.js");
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
    /**
     * Горячих запросов панели два, и мерить надо оба (task-064): старый
     * полный список ещё кормит ленту и догон, а сводный ответ считает
     * непрочитанное по каждому проекту. Обход переписки в любом из них
     * одинаково кладёт панель.
     */
    const hot = [
      { name: "список панели", ...listConversationsFor(db, pid, wid).toSQL() },
      { name: "счётчики проектов", ...projectCountsFor(db, pid, wid).toSQL() },
      /**
       * Лента вперёд от давнего номера (task-099): переход к сообщению годичной
       * давности обязан читать страницу, а не всё, что новее него. Номер —
       * из начала истории, чтобы на большом объёме «новее» было десятками тысяч.
       */
      { name: "лента вперёд", ...listMessagesNewer(db, cid, 50, 100).toSQL() },
      /**
       * Поиск (task-100) — частое и редкое слово: у них разные дешёвые пути
       * (обход по номеру и выборка из индекса слов), и обход всей переписки
       * прячется ровно в неверном выборе пути для одного из них.
       */
      {
        name: "поиск частого слова",
        ...searchMessagesPage(
          db,
          { participantId: pid, workspaceId: wid },
          tsqueryOf(["замер"]),
          20,
        ).toSQL(),
      },
      {
        name: "поиск редкого слова",
        ...searchMessagesPage(
          db,
          { participantId: pid, workspaceId: wid },
          tsqueryOf(["лиственница"]),
          20,
        ).toSQL(),
      },
    ];

    /** Досеять переписку до нужного объёма и померить панель. */
    const measure = async (from, to) => {
      await client.query(
        `INSERT INTO message (workspace_id, conversation_id, author_participant_id, body,
                              client_msg_id, seq, updated_seq, created_at)
         SELECT $1, $2, $3,
                -- Редкое слово — ровно в одной реплике на любом объёме (task-100):
                -- выборка из индекса слов законно стоит по числу совпадений, и гейт
                -- стережёт рост от объёма переписки, а не от числа найденного.
                'замер ' || g || CASE WHEN g = 7 THEN ' лиственница' ELSE '' END,
                gen_random_uuid(), g, g,
                now() - (g || ' seconds')::interval
         FROM generate_series($4::int, $5::int) g`,
        [wid, cid, pid, from, to],
      );
      // Реплики — свои, а отправка сдвигает отметку прочтения автора
      // (своих непрочитанных не бывает). Сеем тем же правилом, что держит
      // продукт: иначе гейт мерил бы мир, которого в продукте нет.
      await client.query(
        `INSERT INTO conversation_read (conversation_id, participant_id, read_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, participant_id) DO UPDATE SET read_seq = $3`,
        [cid, pid, to],
      );
      await client.query("ANALYZE message");
      // Таблицу поиска наполняет триггер; путь поиска выбирается по её статистике.
      await client.query("ANALYZE message_search");
      const measured = [];
      for (const one of hot) {
        const { rows: plan } = await client.query(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${one.sql}`,
          one.params,
        );
        measured.push({ name: one.name, rows: planRows(plan[0]["QUERY PLAN"][0].Plan) });
      }
      return measured;
    };

    const onSmall = await measure(1, SMALL);
    const onLarge = await measure(SMALL + 1, LARGE);
    const grown = onSmall.map((one, at) => ({
      name: one.name,
      small: one.rows,
      large: onLarge[at].rows,
      growth: onLarge[at].rows - one.rows,
    }));
    const worst = grown.reduce((most, one) => (one.growth > most.growth ? one : most));

    await client.query("ROLLBACK");

    const limit = Number(readFileSync(RATCHET, "utf8").trim());
    if (!Number.isFinite(limit)) {
      console.error(`${RATCHET}: не число`);
      process.exit(1);
    }

    if (worst.growth > limit) {
      console.error(
        [
          "",
          `Цена панели растёт с объёмом переписки: ${worst.name}.`,
          "",
          `  на ${SMALL} репликах — ${worst.small} строк`,
          `  на ${LARGE} репликах — ${worst.large} строк`,
          `  прирост ${worst.growth} при разрешённых ${limit}`,
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
      `${grown
        .map(
          (one) =>
            `${one.name}: ${one.small} строк на ${SMALL}, ${one.large} на ${LARGE} ` +
            `(прирост ${one.growth})`,
        )
        .join("; ")} — при разрешённых ${limit} от объёма не зависит — OK`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
