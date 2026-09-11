import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";

/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЗАМКА МИГРАЦИЙ (task-030, В-1). Бьёт по НАСТОЯЩЕМУ Postgres.
 *
 * ⚠️ ПОЧЕМУ НЕ БЫСТРАЯ ПРОВЕРКА С ПОДСТАВНЫМ ИСПОЛНИТЕЛЕМ. Подстава доказала бы
 * ровно одно: что мы позвали функцию с нужным именем. О том, работает ли замок,
 * она не говорит ничего — замок живёт в СЕАНСЕ базы, и проверить его можно
 * только базой. Ровно это замечание и вернуло прошлую редакцию плана.
 *
 * ⚠️ ПОЧЕМУ ОТДЕЛЬНАЯ БАЗА, А НЕ РАБОЧАЯ. Рабочая уже накатана: оба запуска
 * применили бы ноль, и проверка была бы зелёной, ничего не проверив, —
 * то есть худший вид арбитра. Здесь база рождается пустой и умирает после.
 *
 * Что доказывается: два одновременных накатывания применяют каждую миграцию
 * РОВНО ОДИН РАЗ. У Drizzle своей защиты нет (drizzle-orm#874), и без нашего
 * замка второй запуск пытался бы создать то, что уже создано.
 *
 * Перед запуском: make up
 */

/** Имя времянки. Своё, чтобы не столкнуться ни с рабочей базой, ни с чужой. */
const PROBE = "amplifie_проба_замка";

/**
 * Настройки берутся из `.env`, а НЕ из умолчаний.
 *
 * Умолчание у адреса базы — это уже прожитая ошибка: в `make migrate` стоял
 * порт по умолчанию, он разошёлся с настоящим, и команда молча ходила не туда.
 * Нет файла — говорим об этом прямо, а не подставляем догадку.
 */
function fromEnv(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch {
    throw new Error("нет .env — выполните `make env`, иначе адрес базы неизвестен");
  }

  const pairs: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const [, key, value] = /^([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(line.trim()) ?? [];
    if (key) pairs[key] = value ?? "";
  }
  return pairs;
}

function urlFor(database: string): string {
  const env = fromEnv();
  const required = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST_PORT"];
  for (const key of required) {
    if (!env[key]) throw new Error(`в .env нет ${key} — адрес базы собрать не из чего`);
  }
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_HOST_PORT}/${database}`;
}

/** Сколько миграций лежит в дереве — с ними и сверяем применённое. */
function migrationCount(): number {
  const journal = JSON.parse(
    readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

async function asAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const env = fromEnv();
  const client = new pg.Client({ connectionString: urlFor(env.POSTGRES_DB ?? "postgres") });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await asAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${PROBE}"`);
    await client.query(`CREATE DATABASE "${PROBE}"`);
  });
}, 30_000);

afterAll(async () => {
  // Времянка не переживает прогон: иначе следующий увидит её накатанной
  // и снова окажется зелёным, ничего не проверив.
  await asAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${PROBE}"`);
  });
});

it("два одновременных накатывания применяют каждую миграцию ровно один раз", async () => {
  const url = urlFor(PROBE);
  const total = migrationCount();
  expect(total).toBeGreaterThan(0);

  // Настоящая одновременность: оба стартуют, не дожидаясь друг друга.
  const [first, second] = await Promise.all([runMigrations(url), runMigrations(url)]);

  // ① Кто-то один сделал всю работу, второй дождался и не сделал ничего.
  // Без замка оба полезли бы применять одно и то же.
  expect([first, second].toSorted((a, b) => a - b)).toEqual([0, total]);

  // ② И главное — в журнале базы каждая миграция ровно по разу.
  // Это проверка результата, а не наших же чисел выше.
  const recorded = await journalRows(url);
  expect(recorded).toBe(total);
}, 60_000);

async function journalRows(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}
