import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { накатить } from "../src/migrate.js";

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
const ПРОБА = "amplifie_проба_замка";

/**
 * Настройки берутся из `.env`, а НЕ из умолчаний.
 *
 * Умолчание у адреса базы — это уже прожитая ошибка: в `make migrate` стоял
 * порт по умолчанию, он разошёлся с настоящим, и команда молча ходила не туда.
 * Нет файла — говорим об этом прямо, а не подставляем догадку.
 */
function изEnv(): Record<string, string> {
  let текст: string;
  try {
    текст = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  } catch {
    throw new Error("нет .env — выполните `make env`, иначе адрес базы неизвестен");
  }

  const пары: Record<string, string> = {};
  for (const строка of текст.split(/\r?\n/u)) {
    const [, имя, значение] = /^([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(строка.trim()) ?? [];
    if (имя) пары[имя] = значение ?? "";
  }
  return пары;
}

function адрес(база: string): string {
  const env = изEnv();
  const нужно = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST_PORT"];
  for (const имя of нужно) {
    if (!env[имя]) throw new Error(`в .env нет ${имя} — адрес базы собрать не из чего`);
  }
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_HOST_PORT}/${база}`;
}

/** Сколько миграций лежит в дереве — с ними и сверяем применённое. */
function сколькоМиграций(): number {
  const журнал = JSON.parse(
    readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: unknown[] };
  return журнал.entries.length;
}

async function наАдминской<T>(дело: (client: pg.Client) => Promise<T>): Promise<T> {
  const env = изEnv();
  const client = new pg.Client({ connectionString: адрес(env.POSTGRES_DB ?? "postgres") });
  await client.connect();
  try {
    return await дело(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await наАдминской(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${ПРОБА}"`);
    await client.query(`CREATE DATABASE "${ПРОБА}"`);
  });
}, 30_000);

afterAll(async () => {
  // Времянка не переживает прогон: иначе следующий увидит её накатанной
  // и снова окажется зелёным, ничего не проверив.
  await наАдминской(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${ПРОБА}"`);
  });
});

it("два одновременных накатывания применяют каждую миграцию ровно один раз", async () => {
  const url = адрес(ПРОБА);
  const всего = сколькоМиграций();
  expect(всего).toBeGreaterThan(0);

  // Настоящая одновременность: оба стартуют, не дожидаясь друг друга.
  const [первый, второй] = await Promise.all([накатить(url), накатить(url)]);

  // ① Кто-то один сделал всю работу, второй дождался и не сделал ничего.
  // Без замка оба полезли бы применять одно и то же.
  expect([первый, второй].toSorted((a, b) => a - b)).toEqual([0, всего]);

  // ② И главное — в журнале базы каждая миграция ровно по разу.
  // Это проверка результата, а не наших же чисел выше.
  const записей = await наАдминскойПробы(url);
  expect(записей).toBe(всего);
}, 60_000);

async function наАдминскойПробы(url: string): Promise<number> {
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
