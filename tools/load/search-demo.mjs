#!/usr/bin/env node
/**
 * Поиск на засеве — чтобы владелец потыкал его руками (task-100, шаг 6).
 *
 * ЧТО ДЕЛАЕТ. Поднимает рядом со стендом второй сервер и прокси, которые
 * смотрят в базу засева, а не в рабочую базу стенда:
 * 1. отдельная сеть Docker, в неё подключается тот же контейнер Postgres;
 * 2. человеку засева, состоящему в 200 закрытых чатах, ставится пароль —
 *    тем же хешем, что у сервера (`hashPassword`), а не своей копией;
 * 3. сервер (`amplifie/api`) с адресом базы засева и прокси со статикой
 *    (`amplifie/web`) — на своём порту.
 *
 * ⚠️ СТЕНД НЕ ТРОГАЕТСЯ. Рабочая база, контейнеры и порт 8477 остаются как
 * были. Контейнеры показа запускаются с `--rm`: `make search-demo-stop`
 * их останавливает, и они исчезают сами.
 *
 * ⚠️ ОБРАЗЫ — ТЕ ЖЕ, ЧТО У СТЕНДА: сначала `make up`, иначе показ соберёт
 * старую версию поиска.
 *
 * Запуск: make search-demo · остановить: make search-demo-stop
 * База: SEARCH_DATABASE=amplifie_search_tail (по умолчанию)
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import { hostDatabaseUrl } from "./host-database.mjs";

const DATABASE = process.env.SEARCH_DATABASE ?? "amplifie_search_tail";
const PORT = process.env.SEARCH_DEMO_PORT ?? "8479";
const NETWORK = "amplifie_search_demo";
const API = "amplifie-search-demo-api";
const WEB = "amplifie-search-demo-web";
/** Пароль показа. База засева — не рабочие данные, секрета здесь нет. */
const PASSWORD = "поиск-на-засеве";

function docker(args, { quiet = false } = {}) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: quiet ? "pipe" : undefined,
    }).trim();
  } catch (error) {
    if (quiet) return null;
    throw error;
  }
}

/** Кому ставим пароль: человек с наибольшим числом закрытых чатов — видит и закрытое. */
async function person() {
  process.env.DATABASE_URL = hostDatabaseUrl(DATABASE);
  const { hashPassword } = await import("../../backend/dist/kernel/identity/service.js");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT a.id, a.email, count(m.conversation_id)::int AS closed
       FROM participant p JOIN account a ON a.id = p.account_id
       LEFT JOIN conversation_member m ON m.participant_id = p.id
       GROUP BY a.id, a.email ORDER BY closed DESC LIMIT 1`,
    );
    const who = rows[0];
    if (!who) throw new Error(`в базе ${DATABASE} нет людей — сначала make search-seed`);
    await client.query("UPDATE account SET password_hash = $1 WHERE id = $2", [
      await hashPassword(PASSWORD),
      who.id,
    ]);
    return who;
  } finally {
    await client.end();
    const { pool } = await import("../../backend/dist/platform/db.js");
    await pool.end();
  }
}

function start() {
  const env = Object.fromEntries(
    docker(["inspect", "amplifie-api-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"])
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  const database = new URL(env.DATABASE_URL);
  database.pathname = `/${DATABASE}`;

  if (docker(["network", "inspect", NETWORK], { quiet: true }) === null) {
    docker(["network", "create", NETWORK]);
  }
  // Тот же Postgres под тем же именем — адрес базы в переменных не меняется.
  docker(["network", "connect", "--alias", "postgres", NETWORK, "amplifie-postgres-1"], {
    quiet: true,
  });

  const keep = ["AMPLIFIE_SECRET_KEY", "AMPLIFIE_SECRET_KEY_VERSION", "LOG_LEVEL", "NODE_ENV"];
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    API,
    "--network",
    NETWORK,
    "--network-alias",
    "api",
    ...keep.flatMap((name) => (env[name] === undefined ? [] : ["-e", `${name}=${env[name]}`])),
    "-e",
    `DATABASE_URL=${database}`,
    "-e",
    "API_PORT=3000",
    "amplifie/api:latest",
  ]);
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    WEB,
    "--network",
    NETWORK,
    "-p",
    `127.0.0.1:${PORT}:80`,
    "amplifie/web:latest",
  ]);
}

function stop() {
  docker(["stop", WEB], { quiet: true });
  docker(["stop", API], { quiet: true });
  docker(["network", "disconnect", NETWORK, "amplifie-postgres-1"], { quiet: true });
}

if (process.argv.includes("--stop")) {
  stop();
  console.log("показ поиска остановлен; стенд не тронут");
} else {
  const who = await person();
  stop();
  start();
  console.log(
    [
      `показ поиска на засеве ${DATABASE}: http://localhost:${PORT}`,
      `вход: ${who.email} / ${PASSWORD} — состоит в ${who.closed} закрытых чатах`,
      "остановить: make search-demo-stop",
    ].join("\n"),
  );
}
