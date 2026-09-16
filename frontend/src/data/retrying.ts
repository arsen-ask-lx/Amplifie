import { nextDelay } from "@amplifie/contract";
import { liveTroubleOf } from "../shared/trouble.js";

/**
 * Работа, которая не сдаётся после отказа (task-093, срез 1).
 *
 * ⚠️ У ПОВТОРА ОДИН ХОЗЯИН. Догон зовут трое — событие с разрывом,
 * переподключение потока и страховочный таймер. Каждый со своим повтором
 * дал бы три таймера и три прохода на один отказ. Здесь таймер один:
 * свежий сигнал снимает запланированный повтор и идёт сразу.
 *
 * ⚠️ 401 НЕ ПОВТОРЯЕТСЯ. Сессии нет — повтор бессмыслен и тратит порог
 * частоты; человеку нужен вход, а не «пробуем снова».
 *
 * Сама работа должна сама не бегать дважды разом (догон так и устроен —
 * `catchUp.ts`); здесь только «когда пробовать снова».
 */

export interface RetryingHandlers {
  /** Сколько раз подряд не вышло. */
  onFailures: (failures: number) => void;
  /** Получилось после отказов или с первого раза. */
  onRecovered: () => void;
  onSessionEnded: () => void;
}

export interface RetryingDeps {
  random: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

const browser: RetryingDeps = {
  random: Math.random,
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
};

export interface Retrying {
  /** Сделать сейчас; если ждал повтор — он снимается. */
  kick: () => void;
  /** Больше не пробовать: снять таймер. */
  stop: () => void;
}

export function retrying(
  run: () => Promise<void>,
  handlers: RetryingHandlers,
  deps: RetryingDeps = browser,
): Retrying {
  let failures = 0;
  let timer: unknown;
  let stopped = false;
  /** Проход, за исходом которого уже следим. */
  let watched: Promise<void> | null = null;

  const failed = (error: unknown) => {
    if (liveTroubleOf(error) === "сессии-нет") {
      stopped = true;
      handlers.onSessionEnded();
      return;
    }
    failures += 1;
    handlers.onFailures(failures);
    timer = deps.setTimeout(
      () => {
        timer = undefined;
        kick();
      },
      nextDelay(failures - 1, deps.random),
    );
  };

  const kick = () => {
    if (stopped) return;
    if (timer !== undefined) {
      deps.clearTimeout(timer);
      timer = undefined;
    }
    /**
     * ⚠️ `run` ЗОВЁТСЯ ВСЕГДА, А ИСХОД ОДНОГО ПРОХОДА СЧИТАЕТСЯ ОДИН РАЗ.
     * Догон во время прохода отдаёт тот же промис и заказывает ещё один
     * круг — поэтому звать его надо. Но второй обработчик на тот же промис
     * посчитал бы один отказ дважды и перескочил ступень задержки.
     */
    const pass = run();
    if (pass === watched) return;
    watched = pass;
    pass.then(
      () => {
        if (watched === pass) watched = null;
        if (stopped) return;
        failures = 0;
        handlers.onRecovered();
      },
      (error: unknown) => {
        if (watched === pass) watched = null;
        if (!stopped) failed(error);
      },
    );
  };

  return {
    kick,
    stop: () => {
      stopped = true;
      if (timer !== undefined) deps.clearTimeout(timer);
      timer = undefined;
    },
  };
}
