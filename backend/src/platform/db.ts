import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "./config.js";
import { COUNTERS, count, gauge } from "./metrics.js";

/**
 * Единственный пул на процесс.
 *
 * Прямые запросы к базе разрешены ТОЛЬКО в слое хранилища модуля-владельца
 * таблицы. Это стережёт `make arch` (Р-047), а не договорённость.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Счёт запросов к базе в пределах одного запроса HTTP (task-039, шаг 5).
 *
 * N+1 не виден ни в типах, ни на трёх строках — только числом запросов,
 * растущим вместе с данными. Счёт живёт в `AsyncLocalStorage`: так
 * запросы одного обращения не смешиваются с соседними, идущими разом.
 * Готового детектора N+1 для Node нет; это тот же приём, что
 * `assertNumQueries` у Django, собранный из штатных частей.
 */
const counting = new AsyncLocalStorage<{ queries: number }>();

/** Выполнить `work` со своим счётом запросов; счёт — в `queriesSoFar`. */
export function countQueries(work: () => void): void {
  counting.run({ queries: 0 }, work);
}

/** Сколько запросов к базе сделано в текущем обращении. `null` — счёт не ведётся. */
export function queriesSoFar(): number | null {
  return counting.getStore()?.queries ?? null;
}

export const db = drizzle(pool, {
  logger: {
    logQuery() {
      // Два счёта на одно событие, и это не дубль: первый про ОДНО
      // обращение (его отдаёт заголовок стенда), второй — про весь
      // процесс. Именно их расхождение ловит враньё прибора (task-087).
      count(COUNTERS.dbQueries);
      const store = counting.getStore();
      if (store) store.queries += 1;
    },
  },
});

/**
 * Пул рассказывает о себе сам — считать ничего не надо.
 *
 * Занято и ОЧЕРЕДЬ — разные вещи, и второе важнее: пул из десяти
 * бывает занят полностью и без беды, а вот очередь за ним — это уже
 * чужое ожидание (Saturation из USE).
 */
gauge("amplifie_pool_busy", "занято соединений пула", () => pool.totalCount - pool.idleCount);
gauge("amplifie_pool_waiting", "ждут свободного соединения", () => pool.waitingCount);

type Db = NodePgDatabase;

/** Транзакция. Тот же интерфейс, что у db, — службы принимают либо то, либо это. */
export type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
export type Executor = Db | Tx;

/**
 * Всё-или-ничего.
 *
 * ⚠️ Вызов модели внутрь транзакции не помещать НИКОГДА: он идёт 10–30 секунд,
 * и всё это время строка заблокирована, а горизонт очистки стоит.
 * Порядок такой: прочитал → позвал модель (вне транзакции) → записал.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/**
 * Сколько миграций накатано (Р-030 ⑥).
 *
 * Стоит рядом с `pingDatabase`, а не в модуле-владельце: у служебной таблицы
 * миграций владельца нет — она принадлежит самой установке, как и ответ
 * на вопрос «что у вас стоит».
 *
 * `null`, если таблицы ещё нет: на пустой базе это начало, а не отказ,
 * и врать нулём здесь нельзя — ноль накатанных и «не знаю» разные новости.
 */
export async function appliedMigrations(): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
