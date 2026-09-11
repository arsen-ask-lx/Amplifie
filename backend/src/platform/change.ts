import { publish } from "./bus.js";
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
 */
export async function change<T>(workspaceId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await withTransaction(work);
  publish(workspaceId);
  return result;
}
