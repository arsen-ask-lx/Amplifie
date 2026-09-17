import { nextDelay } from "@amplifie/contract";
import { liveTroubleOf } from "../shared/trouble.js";

/**
 * Работа, которая не сдаётся после отказа (task-093, срез 1).
 *
 * ⚠️ У ПОВТОРА ОДИН ХОЗЯИН. Догон зовут трое — событие с разрывом,
 * переподключение потока и страховочный таймер. Каждый со своим повтором
 * дал бы три таймера и три прохода на один отказ. Здесь таймер один.
 * Событие во время паузы её не снимает; снимает только доказанная связь
 * (`now`: поток переподключился, человек вернулся во вкладку).
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
  /**
   * «Что-то изменилось». Сразу, если повтора не ждём; во время ожидания —
   * ничего: запланированный проход заберёт всё после курсора (task-097).
   */
  kick: () => void;
  /** «Связь доказана»: поток переподключился, человек вернулся. Снять ожидание и идти. */
  now: () => void;
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
        go();
      },
      nextDelay(failures - 1, deps.random),
    );
  };

  /**
   * Один проход.
   *
   * ⚠️ `run` ЗОВЁТСЯ ВСЕГДА, А ИСХОД ОДНОГО ПРОХОДА СЧИТАЕТСЯ ОДИН РАЗ.
   * Догон во время прохода отдаёт тот же промис и заказывает ещё один
   * круг — поэтому звать его надо. Но второй обработчик на тот же промис
   * посчитал бы один отказ дважды и перескочил ступень задержки.
   */
  function go(): void {
    if (stopped) return;
    const attempt = run();
    if (attempt === watched) return;
    watched = attempt;
    attempt.then(
      () => {
        if (watched === attempt) watched = null;
        if (stopped) return;
        failures = 0;
        handlers.onRecovered();
      },
      (error: unknown) => {
        if (watched === attempt) watched = null;
        if (!stopped) failed(error);
      },
    );
  }

  /**
   * ⚠️ СОБЫТИЯ НЕ ТОРОПЯТ ПОВТОР (task-097). Раньше любой сигнал снимал
   * паузу: пока в чате писали, каждая реплика после отказа шла в догон
   * сразу, и сервер в беде получал запросов больше, а не меньше.
   * Спецификация `talk/live-updates` обещает обратное. Пропуска нет:
   * запланированный проход заберёт всё после курсора.
   */
  const kick = () => {
    if (timer !== undefined) return;
    go();
  };

  const now = () => {
    if (timer !== undefined) {
      deps.clearTimeout(timer);
      timer = undefined;
    }
    go();
  };

  return {
    kick,
    now,
    stop: () => {
      stopped = true;
      if (timer !== undefined) deps.clearTimeout(timer);
      timer = undefined;
    },
  };
}
