/**
 * Счётчик транзакций самой базы — общий для замеров и гейтов.
 *
 * `pg_stat_database.xact_commit` — сколько транзакций Postgres зафиксировал
 * с момента запуска. Разница между двумя чтениями и есть цена работы,
 * случившейся между ними.
 *
 * ⚠️ ЭТО ТРАНЗАКЦИИ, А НЕ ОПЕРАТОРЫ, и разница названа, а не спрятана.
 * Оператор вне транзакции — сам себе транзакция, поэтому для дороги чтения
 * счёт идёт один к одному. Мутация, завёрнутая в `change()`, — одна
 * транзакция на несколько операторов: значит число занижает цену записи
 * и точно показывает цену раздачи. Нам нужна вторая.
 *
 * Через `docker compose exec`, а не своим драйвером: замеру не нужен ни пул,
 * ни строка подключения снаружи контейнера. Одна зависимость меньше — один
 * способ соврать меньше.
 */

import { execFileSync } from "node:child_process";

export function committed() {
  const out = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "amplifie",
      "-d",
      process.env.POSTGRES_DB ?? "amplifie",
      "-Atc",
      "select xact_commit from pg_stat_database where datname = current_database()",
    ],
    { encoding: "utf8" },
  );
  const value = Number(out.trim());
  if (!Number.isFinite(value)) throw new Error(`не прочитал счётчик базы: ${out.trim()}`);
  return value;
}

export async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Окно наблюдения: что база накоммитила, пока внутри окна шла работа.
 *
 * ⚠️ ОКНО ДОЛЖНО БЫТЬ ДОЛЬШЕ, ЧЕМ УСПЕВАЕТ СТАДО. Если догоны не успели
 * закончиться внутри окна, замер покажет не цену события, а пропускную
 * способность стенда — и числа поплывут от прогона к прогону. Проверено:
 * на четырёх секундах и ста вкладках два прогона дали 154 и 44.
 */
export async function windowOf(work, windowMs) {
  const before = committed();
  await work();
  await wait(windowMs);
  return committed() - before;
}
