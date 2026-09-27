import { nextDelay } from "@amplifie/contract";
import { screenTroubleOf } from "../shared/trouble.js";

/**
 * Загрузка, которая переживает короткий сбой сервера (task-096).
 *
 * ⚠️ ТОЛЬКО ДЛЯ ЗАГРУЗОК, БЕЗ КОТОРЫХ НЕТ ЭКРАНА, — кто я, панель, первая
 * страница ленты, закреплённое. Не для всех чтений: опросы настроек идут
 * по таймеру сами, порции панели перечитываются по звонку, листание назад
 * — десяток страниц подряд. Повтор внутри них умножил бы запросы именно
 * в ту минуту, когда сервер и так в беде.
 *
 * ⚠️ ПО СРОКУ, А НЕ ПО ЧИСЛУ ПОПЫТОК. При полном разбросе «четыре попытки»
 * длятся в среднем вдвое меньше худшего случая, а выкладка — 10–25 секунд
 * (замер task-093). Срок в 30 секунд её накрывает; дальше решает человек
 * кнопкой «Повторить».
 *
 * ⚠️ У КАЖДОЙ ПОПЫТКИ СВОЙ ПРЕДЕЛ. Зависший ответ без предела съел бы
 * весь срок одной попыткой.
 */

export const PATIENCE_MS = 30_000;
export const ATTEMPT_MS = 10_000;

export interface PatientDeps {
  now: () => number;
  random: () => number;
  /** Подождать; отмена снаружи прерывает ожидание отказом. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Предел одной попытки, соединённый с отменой снаружи. */
  limit: (ms: number, signal?: AbortSignal) => AbortSignal;
}

const browser: PatientDeps = {
  now: Date.now,
  random: Math.random,
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      });
    }),
  limit: (ms, signal) =>
    signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
};

export async function patient<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  deps: PatientDeps = browser,
): Promise<T> {
  const started = deps.now();
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(deps.limit(ATTEMPT_MS, signal));
    } catch (error) {
      if (signal?.aborted || screenTroubleOf(error) !== "сервер-недоступен") throw error;
      const left = PATIENCE_MS - (deps.now() - started);
      if (left <= 0) throw error;
      await deps.sleep(Math.min(nextDelay(tries, deps.random), left), signal);
    }
  }
}
