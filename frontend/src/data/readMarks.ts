/**
 * Отметки «прочитано»: когда и что сказать серверу (Р-029, task-097).
 *
 * ⚠️ ОТДЕЛЬНЫМ МОДУЛЕМ, А НЕ ТАЙМЕРОМ В ЭФФЕКТЕ. В эффекте жили три ошибки
 * сразу, и ни одну нельзя было поймать быстрой проверкой: отметка уходила
 * на каждую новую реплику, отложенная отметка одного чата затиралась
 * другим, а окно сбрасывалось каждой репликой и в живом чате не кончалось.
 * Здесь — только правило; условия «человек смотрит» остаются у хука.
 *
 * Образец — Telegram Desktop (`data/data_histories.cpp`): состояние на
 * каждый чат, не больше одного запроса в пути, окно не перезапускается.
 *
 * ⚠️ ОДНО ОТСТУПЛЕНИЕ ОТ ОБРАЗЦА, НАЗВАННОЕ ВСЛУХ. У них отметка уходит
 * сразу, когда непрочитанного не осталось. У нас в живом чате — не чаще
 * раза в три секунды: отметка стоит пять обращений к базе, а мгновенной
 * её всё равно никто не увидит — сервер не рассылает её другим вкладкам.
 * Первая отметка после паузы уходит сразу, как и обещает Р-029.
 */

/** Не чаще раза в это окно на один чат. У Telegram та же величина. */
export const READ_WINDOW_MS = 3000;

export interface ReadMarksDeps {
  send: (conversationId: string, seq: number) => Promise<{ unread: number }>;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export interface ReadMarks {
  /** Человек увидел чат до этого номера. */
  seen: (conversationId: string, seq: number) => void;
  /** Уходим из чата — отложенное уходит сейчас, не дожидаясь окна. */
  flush: (conversationId: string) => void;
  /** Уходим со страницы чата — то же для всех. */
  flushAll: () => void;
  /** Больше не планировать и не сообщать ответы. Уже ушедшие запросы доходят. */
  stop: () => void;
}

interface Mark {
  /** Докуда подтвердил сервер. */
  sent: number;
  /** Докуда хотим. */
  want: number;
  /** Когда ушла последняя; `null` — ни разу, значит можно сразу. */
  lastAt: number | null;
  inFlight: boolean;
  /** Не ждать окна: из чата уходят. */
  urgent: boolean;
}

/**
 * @param onSent — сервер подтвердил отметку и назвал остаток непрочитанного.
 */
export function readMarks(
  onSent: (conversationId: string, seq: number, unread: number) => void,
  deps: ReadMarksDeps,
): ReadMarks {
  const marks = new Map<string, Mark>();
  let timer: unknown;
  let stopped = false;

  const markOf = (conversationId: string): Mark => {
    let mark = marks.get(conversationId);
    if (!mark) {
      mark = { sent: 0, want: 0, lastAt: null, inFlight: false, urgent: false };
      marks.set(conversationId, mark);
    }
    return mark;
  };

  const dueAt = (mark: Mark, now: number) =>
    mark.urgent || mark.lastAt === null ? now : mark.lastAt + READ_WINDOW_MS;

  function fire(conversationId: string, mark: Mark, now: number): void {
    const target = mark.want;
    mark.inFlight = true;
    mark.urgent = false;
    mark.lastAt = now;
    deps.send(conversationId, target).then(
      ({ unread }) => {
        mark.inFlight = false;
        mark.sent = Math.max(mark.sent, target);
        if (!stopped) onSent(conversationId, target, unread);
        plan();
      },
      () => {
        /**
         * ⚠️ ОТКАЗ НЕ ПОВТОРЯЕТСЯ, НО И НЕ ТЕРЯЕТСЯ. Повтор здесь незачем:
         * отметка безопасна — не дошла, число просто останется (Р-029).
         * Но желаемое откатывается к подтверждённому, иначе следующий
         * взгляд на тот же номер решил бы «уже отправлено» и промолчал бы
         * навсегда.
         */
        mark.inFlight = false;
        if (mark.want === target) mark.want = mark.sent;
        plan();
      },
    );
  }

  const waiting = (mark: Mark) => !mark.inFlight && mark.want > mark.sent;

  /** Отправить всё, чему пора. Отдаёт ближайший будущий срок либо `null`. */
  function sendDue(now: number): number | null {
    const pending = [...marks].filter(([, mark]) => waiting(mark));
    const later = pending.map(([, mark]) => dueAt(mark, now)).filter((due) => due > now);
    for (const [conversationId, mark] of pending) {
      if (dueAt(mark, now) <= now) fire(conversationId, mark, now);
    }
    return later.length > 0 ? Math.min(...later) : null;
  }

  function cancel(): void {
    if (timer !== undefined) deps.clearTimeout(timer);
    timer = undefined;
  }

  /** Отправить всё, чему пора; на остальное — один таймер к ближайшему сроку. */
  function plan(): void {
    if (stopped) return;
    cancel();
    const now = deps.now();
    const next = sendDue(now);
    if (next !== null) timer = deps.setTimeout(plan, next - now);
  }

  return {
    seen: (conversationId, seq) => {
      const mark = markOf(conversationId);
      if (seq <= mark.want || seq <= mark.sent) return;
      mark.want = seq;
      plan();
    },
    flush: (conversationId) => {
      const mark = marks.get(conversationId);
      if (!mark || mark.want <= mark.sent) return;
      mark.urgent = true;
      plan();
    },
    flushAll: () => {
      for (const mark of marks.values()) if (mark.want > mark.sent) mark.urgent = true;
      plan();
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}
