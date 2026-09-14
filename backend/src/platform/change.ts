import { type Change, publish } from "./bus.js";
import { type Tx, withTransaction } from "./db.js";

/**
 * Изменение общего состояния: транзакция, а после фиксации — звонок (Р-006).
 *
 * Одна обёртка на все мутации, а не две строки в каждой. Звонок, который
 * ставили руками, однажды забыли (заводка ветки), и новое появлялось
 * у соседей только после перезагрузки (task-039).
 *
 * Звонок строго ПОСЛЕ фиксации: позвони раньше — клиент придёт в догон
 * за тем, чего в базе ещё нет, а второго звонка не будет.
 *
 * ⚠️ АДРЕС ОБЯЗАТЕЛЕН, И ЭТО РЕШЕНИЕ, А НЕ НЕУДОБСТВО. Звонок без адреса
 * поднимает все вкладки пространства (Д-3, task-067), поэтому «забыть
 * адрес» не должно быть возможно молча — параметр обязателен типом.
 * Изменение, которое действительно касается всего пространства (заводка
 * проекта, переименование папки), передаёт `null` — но передаёт явно.
 */
export async function change<T>(
  workspaceId: string,
  work: (tx: Tx) => Promise<T>,
  /** Где изменилось: идентификатор разговора либо `null` — «всё пространство». */
  address: string | null | ((result: T) => string | null),
): Promise<T> {
  const result = await withTransaction(work);
  const conversation = typeof address === "function" ? address(result) : address;
  await publish(workspaceId, { conversation } satisfies Change);
  return result;
}
