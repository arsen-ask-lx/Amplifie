import { randomUUID } from "node:crypto";

/**
 * Встреча вопроса и моста: человек спрашивает здесь, машина отвечает там.
 *
 * ЗАЧЕМ ОНА ЕСТЬ. Подписка живёт на машине человека, а не у нас. Сервер
 * не может позвонить на ноутбук: у того нет открытого адреса. Поэтому мост
 * сам приходит за работой и ждёт — а вопрос ждёт его ответа. Здесь эти два
 * ожидания встречаются.
 *
 * ЧТО ЭТО НЕ ОЧЕРЕДЬ. Ничего не хранится: задание живёт в памяти процесса
 * ровно между двумя запросами. Перезапуск сервера теряет незавершённые
 * вопросы — и это приемлемо, потому что вопрос задаётся заново и ничего
 * не испорчено. Настоящая очередь понадобится на **втором процессе
 * приложения**: тогда вопрос придёт в один, а мост будет ждать в другом.
 * Этот порог назван заранее и записан в task-001.
 *
 * ПОЧЕМУ НЕ WebSocket. Длинное ожидание обычным HTTP решает ту же задачу,
 * проходит через тот же Caddy и не заводит второй транспорт рядом с SSE.
 */

/** Мост взял задание и не ответил в срок. */
export class BridgeSilentError extends Error {}
/** Мост ответил, но отказом: у него что-то не так со своей стороны. */
export class BridgeFailedError extends Error {}

export interface Job {
  jobId: string;
  system: string;
  prompt: string;
}

interface Waiting {
  job: Job;
  settle: (result: { text: string } | { failure: Error }) => void;
  timer: NodeJS.Timeout;
}

/** Задания, которых мост ещё не забрал. Ключ — мост. */
const queued = new Map<string, Job[]>();
/** Кто ждёт ответа. Ключ — задание. */
const pending = new Map<string, Waiting>();
/** Мосты, стоящие с открытой рукой: ждут работы прямо сейчас. */
const idle = new Map<string, Array<(job: Job | null) => void>>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function shift<K, V>(map: Map<K, V[]>, key: K): V | undefined {
  const list = map.get(key);
  if (!list || list.length === 0) return undefined;
  const value = list.shift();
  if (list.length === 0) map.delete(key);
  return value;
}

/**
 * Спросить модель через мост. Ждёт ответа или срока.
 *
 * Отдаёт текст либо бросает: молчание и отказ моста — разные вещи,
 * и человеку они объясняются по-разному.
 */
export function askBridge(
  bridgeId: string,
  ask: { system: string; prompt: string },
  waitMs: number,
): Promise<string> {
  const job: Job = { jobId: randomUUID(), system: ask.system, prompt: ask.prompt };

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(job.jobId);
      reject(new BridgeSilentError(`мост не ответил за ${Math.round(waitMs / 1000)} с`));
    }, waitMs);

    pending.set(job.jobId, {
      job,
      timer,
      settle: (result) => {
        clearTimeout(timer);
        pending.delete(job.jobId);
        if ("text" in result) resolve(result.text);
        else reject(result.failure);
      },
    });

    // Мост уже стоит с открытой рукой — отдаём задание сразу.
    const hand = shift(idle, bridgeId);
    if (hand) hand(job);
    else push(queued, bridgeId, job);
  });
}

/**
 * Убрать руку из очереди ожидающих.
 *
 * Обязательно при уходе по сроку: оставленная рука переживёт запрос,
 * и следующее задание уйдёт в никуда — то есть человек не дождётся ответа
 * при живом мосте. Самый неприятный вид отказа: всё выглядит исправным.
 */
function dropHand(bridgeId: string, hand: (job: Job | null) => void): void {
  const hands = idle.get(bridgeId);
  if (!hands) return;
  const at = hands.indexOf(hand);
  if (at >= 0) hands.splice(at, 1);
  if (hands.length === 0) idle.delete(bridgeId);
}

/**
 * Мост пришёл за работой. Если её нет — ждёт до срока и уходит ни с чем.
 *
 * «Ни с чем» — нормальный исход, а не отказ: мост тут же приходит снова.
 * Так соединение остаётся живым, не превращаясь в опрос каждую секунду.
 */
export function nextJob(bridgeId: string, waitMs: number): Promise<Job | null> {
  const ready = shift(queued, bridgeId);
  if (ready) return Promise.resolve(ready);

  return new Promise<Job | null>((resolve) => {
    let done = false;
    const hand = (job: Job | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(job);
    };
    const timer = setTimeout(() => {
      dropHand(bridgeId, hand);
      hand(null);
    }, waitMs);

    push(idle, bridgeId, hand);
  });
}

/**
 * Мост принёс ответ. Возвращает, ждал ли его кто-нибудь.
 *
 * Не ждал — значит срок вышел или сервер перезапускался. Это не ошибка
 * моста, и ругаться на него незачем; но и молча считать успехом нельзя,
 * поэтому исход возвращается вызывающему.
 */
export function deliver(
  jobId: string,
  result: { text: string } | { error: string },
): "доставлено" | "никто-не-ждал" {
  const waiting = pending.get(jobId);
  if (!waiting) return "никто-не-ждал";

  waiting.settle(
    "text" in result ? { text: result.text } : { failure: new BridgeFailedError(result.error) },
  );
  return "доставлено";
}
