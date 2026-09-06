import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "./config.js";

/**
 * Единственный пул на процесс.
 *
 * Прямые запросы к базе разрешены ТОЛЬКО в слое хранилища модуля-владельца
 * таблицы. Это стережёт гейт dependency-cruiser, а не договорённость.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool);

export type Db = NodePgDatabase;
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

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
