import { readFileSync } from "node:fs";

/**
 * Строка подключения к базе стенда СНАРУЖИ контейнера.
 *
 * ⚠️ ТА, ЧТО В `.env`, СЮДА НЕ ГОДИТСЯ. Там адрес внутри сети docker
 * (`postgres:5432`) — им ходят api и мигратор, живущие в контейнерах.
 * Гейты и замеры запускаются с машины, как приёмочные тесты, и им нужен
 * опубликованный порт. Собираем строку из тех же кусков `.env`, а не заводим
 * вторую переменную: два ответа на «где база» однажды разойдутся.
 *
 * Вынесено из гейта цены (task-100): замеру поиска нужна та же строка,
 * но к отдельной базе — `database` меняет только её имя.
 */
export function hostDatabaseUrl(database) {
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
  const name = database ?? env.POSTGRES_DB;
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/${name}`;
}
