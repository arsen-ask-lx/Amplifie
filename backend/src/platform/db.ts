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
