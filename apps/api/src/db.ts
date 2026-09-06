import pg from "pg";
import { config } from "./config.js";

/**
 * Единственный пул на процесс. Прямые запросы к базе разрешены только
 * в слое хранилища каждого модуля — это стережёт гейт dependency-cruiser.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
