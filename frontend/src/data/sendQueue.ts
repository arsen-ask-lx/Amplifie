import { nextDelay } from "@amplifie/contract";
import { retryAfterOf } from "../shared/failure.js";
import { type SendTrouble, sendTroubleOf } from "../shared/trouble.js";
import { api, type Message, type Quote } from "./api.js";
import { type Local, maxSeq } from "./feed.js";
import { ATTEMPT_MS, PATIENCE_MS } from "./patient.js";

/**
 * Очередь отправки своих реплик — одна на вкладку (task-111, Д-52).
 *
 * ⚠️ ЕДИНСТВЕННЫЙ ХОЗЯИН НЕОТПРАВЛЕННОГО. Раньше черновик жил в ленте, а лента
 * теряет его дважды: при смене чата страница другого чата заменяет ленту,
 * при уходе в настройки снимается весь экран чата. Черновик, пропавший из
 * ленты, некому пометить «!» — реплика терялась молча. Теперь неотправленное
 * живёт здесь, а лента показывает его поверх записанного (`withDrafts`).
 *
 * ⚠️ ПО ОДНОЙ, И ЭТО НЕ ОСТОРОЖНОСТЬ. Параллельные отправки приходят на сервер
 * в случайном порядке, а у порога частоты упираются в него все разом. Как
 * у Telegram: сервер сказал «подожди N секунд» — очередь ждёт и досылает
 * по порядку. Порог — на человека, поэтому и очередь одна, а не на чат.
 * Цена — пачка из N уходит за N ответов сервера.
 */

/** Своя реплика, которую сервер ещё не записал. */
export interface Outgoing {
  clientMsgId: string;
  conversationId: string;
  body: string;
  /**
   * Цитата — момента набора. Очередь держит реплику до минуты, и цитата,
   * взятая в момент отправки, была бы уже чужой.
   */
  replyTo: Quote | null;
  /** Насколько широко читает агент, если его позвали (Р-032). */
  scope: "conversation" | "project";
  author: Message["author"];
  createdAt: string;
  state: NonNullable<Local["state"]>;
}

export interface SendQueueDeps {
  /** Одна попытка; `signal` — её предел. */
  send: (item: Outgoing, signal: AbortSignal) => Promise<Message>;
  /** Позвать агента по записанной реплике. Решает сервер: без обращения — 204. */
  ask: (item: Outgoing) => Promise<unknown>;
  /** Удалить записанную: человек отменил её, пока она была в пути. */
  remove: (messageId: string) => Promise<unknown>;
  now: () => number;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Предел одной попытки: зависший ответ не держит очередь. */
  limit: (ms: number) => AbortSignal;
}

/** Что очередь рассказывает экрану. Экрана может не быть — тогда её никто не слушает. */
export interface SendEvents {
  /** Сервер записал реплику. */
  delivered: (item: Outgoing, message: Message) => void;
  /** Агента позвать не вышло; реплика записана. Чат — её, а не открытый. */
  agentFailed: (item: Outgoing, error: unknown) => void;
  /** Сервер не узнаёт сессию: не уйдёт ничего, пора на вход. */
  sessionEnded: () => void;
}

type Outcome = { sent: true; message: Message } | { sent: false; error: unknown };

/** С какого мига сервер недоступен подряд; `null` — отвечал в прошлый раз. */
interface Outage {
  since: number | null;
}

export class SendQueue {
  private items: readonly Outgoing[] = [];
  private readonly changed = new Set<() => void>();
  private readonly events = new Set<SendEvents>();
  /**
   * Поколение. `clear()` сменяет его, и цикл прежнего, проснувшись после
   * ожидания, не шлёт ничего: неотправленное вышедшего человека не уйдёт
   * с печенькой следующего.
   */
  private generation = 0;
  /** Чей цикл сейчас шлёт; `null` — никто. */
  private draining: number | null = null;
  /** Какая реплика сейчас в пути: её отмену сервер может не успеть заметить. */
  private flying: string | null = null;
  /** Отменённые в пути: если сервер их запишет — удалить там же. */
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: SendQueueDeps) {}

  /** Для `useSyncExternalStore`: подписка и снимок, неизменный между изменениями. */
  subscribe = (onChange: () => void): (() => void) => {
    this.changed.add(onChange);
    return () => {
      this.changed.delete(onChange);
    };
  };

  current = (): readonly Outgoing[] => this.items;

  listen(events: SendEvents): () => void {
    this.events.add(events);
    return () => {
      this.events.delete(events);
    };
  }

  push(item: Omit<Outgoing, "state">): void {
    this.set([...this.items, { ...item, state: "идёт" }]);
    this.drain();
  }

  /**
   * Все «не ушедшие» — ещё раз, тем же ключом: сервер не задвоит.
   *
   * ⚠️ ВСЕ, А НЕ ТА, ПО КОТОРОЙ ЩЁЛКНУЛИ, И НА ПРЕЖНИХ МЕСТАХ. Причина «!»
   * обычно общая — пропала сеть, — и щёлкать по каждому значку в порядке
   * набора — работа машины, а не человека. Места в очереди не меняются,
   * поэтому уходят они в том порядке, в каком набраны.
   */
  retry(): void {
    if (!this.items.some((one) => one.state === "не ушло")) return;
    this.set(this.items.map((one) => (one.state === "не ушло" ? { ...one, state: "идёт" } : one)));
    this.drain();
  }

  /**
   * Не отправлять. Ждущая уходит из очереди сразу. Та, что уже в пути, —
   * тоже, а если сервер успеет её записать, будет удалена там же.
   */
  cancel(clientMsgId: string): void {
    if (this.flying === clientMsgId) this.cancelled.add(clientMsgId);
    this.set(this.items.filter((one) => one.clientMsgId !== clientMsgId));
  }

  /** Человек вышел или кончился сеанс: неотправленное прежнего не уходит. */
  clear(): void {
    this.generation += 1;
    this.set([]);
  }

  private set(items: readonly Outgoing[]): void {
    this.items = items;
    for (const onChange of this.changed) onChange();
  }

  private drain(): void {
    if (this.draining === this.generation) return;
    this.draining = this.generation;
    void this.run(this.generation);
  }

  private async run(generation: number): Promise<void> {
    try {
      for (;;) {
        const head =
          generation === this.generation
            ? this.items.find((one) => one.state === "идёт")
            : undefined;
        if (!head) return;
        await this.deliver(head, generation);
      }
    } finally {
      // Сброс идёт в том же шаге, что и последняя проверка «слать нечего»:
      // реплика, поставленная сразу после, запустит цикл сама, а не повиснет.
      if (this.draining === generation) this.draining = null;
    }
  }

  /** Довести одну реплику до записи, до «!» или до отмены. */
  private async deliver(item: Outgoing, generation: number): Promise<void> {
    const outage: Outage = { since: null };
    for (let tries = 0; this.waiting(item, generation); tries++) {
      const outcome = await this.attempt(item);
      const wait = this.settle(item, outcome, generation, tries, outage);
      if (wait === null) return;
      await this.deps.sleep(wait);
    }
  }

  /** Реплика ещё ждёт отправки: не отменена и очередь не очищена. */
  private waiting(item: Outgoing, generation: number): boolean {
    return (
      generation === this.generation &&
      this.items.some((one) => one.clientMsgId === item.clientMsgId && one.state === "идёт")
    );
  }

  /** Одна попытка — исходом, а не исключением: решение о повторе одно, в `settle`. */
  private async attempt(item: Outgoing): Promise<Outcome> {
    this.flying = item.clientMsgId;
    try {
      return { sent: true, message: await this.deps.send(item, this.deps.limit(ATTEMPT_MS)) };
    } catch (error) {
      return { sent: false, error };
    } finally {
      this.flying = null;
    }
  }

  /** Что после попытки: `null` — с этой репликой всё, число — сколько ждать до новой. */
  private settle(
    item: Outgoing,
    outcome: Outcome,
    generation: number,
    tries: number,
    outage: Outage,
  ): number | null {
    if (this.cancelled.delete(item.clientMsgId)) {
      if (outcome.sent) this.undo(item, outcome.message);
      return null;
    }
    if (generation !== this.generation) return null;
    if (outcome.sent) {
      this.written(item, outcome.message);
      return null;
    }
    const trouble = sendTroubleOf(outcome.error);
    const wait = this.waitBefore(trouble, outcome.error, tries, outage);
    if (wait === null) this.fail(item, trouble);
    return wait;
  }

  /**
   * Сколько ждать перед новой попыткой; `null` — ждать нечего.
   *
   * 429 — сколько сказал сервер, и разброс поверх: иначе все, кому сказали
   * «через семь секунд», вернулись бы одной толпой (`nextDelay`). Сеть и 5xx —
   * столько, сколько терпят загрузки экрана (`patient.ts`): выкладка идёт
   * 10–25 с, и реплики, набранные в это время, не должны встать с «!».
   *
   * ⚠️ ТЕРПЕНИЕ СЧИТАЕТСЯ ОТ ПЕРВОЙ НЕУДАЧИ ПОДРЯД, А НЕ ОТ НАЧАЛА ДОСТАВКИ.
   * Ответ 429 доказывает, что сервер жив, и сбрасывает счёт: иначе минута
   * ожидания по порогу съела бы всё терпение к выкладке, и первый же обрыв
   * после неё поставил бы «!» всем ждущим.
   */
  private waitBefore(
    trouble: SendTrouble,
    error: unknown,
    tries: number,
    outage: Outage,
  ): number | null {
    if (trouble === "подождать") {
      outage.since = null;
      return nextDelay(tries, this.deps.random, retryAfterOf(error));
    }
    if (trouble !== "сервер-недоступен") return null;
    outage.since ??= this.deps.now();
    const left = PATIENCE_MS - (this.deps.now() - outage.since);
    return left > 0 ? Math.min(nextDelay(tries, this.deps.random), left) : null;
  }

  /**
   * «!». Отказано этой реплике — ей одной, следующая идёт своим ходом.
   * Сервера нет дольше терпения или нет сессии — не уйдёт ни одна: «!»
   * у всех ждущих, и ничто не уходит вперёд упавшей.
   */
  private fail(item: Outgoing, trouble: SendTrouble): void {
    const hit =
      trouble === "отказ"
        ? (one: Outgoing) => one.clientMsgId === item.clientMsgId
        : (one: Outgoing) => one.state === "идёт";
    this.set(this.items.map((one) => (hit(one) ? { ...one, state: "не ушло" } : one)));
    if (trouble === "сессии-нет") for (const events of this.events) events.sessionEnded();
  }

  /**
   * Записана. Сперва — слушателям (лента получает запись), потом — уход
   * из очереди: черновик и запись не пропадают с экрана оба ни на кадр.
   */
  private written(item: Outgoing, message: Message): void {
    for (const events of this.events) events.delivered(item, message);
    this.set(this.items.filter((one) => one.clientMsgId !== item.clientMsgId));

    // Агента зовём ВСЕГДА, а решает сервер: правило «звали ли» живёт в одном
    // месте. Чат и область — реплики, а не открытого экрана: `@memo`,
    // записанный через минуту, зовёт агента туда, где его позвали.
    //
    // ⚠️ БЕЗ ОЖИДАНИЯ: ответ модели идёт секунды, а очередь не должна
    // его ждать. Экрана нет — отказ показывать некому, реплика записана.
    this.deps.ask(item).catch((error: unknown) => {
      for (const events of this.events) events.agentFailed(item, error);
    });
  }

  /**
   * Отменённую в пути сервер всё-таки записал — удаляем там же, агента
   * не зовём. Не вышло — показываем как записанную: она у всех на экране,
   * и человек должен это видеть, а не думать, что отменил.
   */
  private undo(item: Outgoing, message: Message): void {
    this.deps.remove(message.id).catch(() => {
      for (const events of this.events) events.delivered(item, message);
    });
  }
}

/**
 * Лента открытого чата с черновиками поверх записанного.
 *
 * ⚠️ НОМЕРА ЧЕРНОВИКОВ РАЗНЫЕ И РАСТУТ, НО ЦЕЛЫМИ НЕ БЫВАЮТ. Лента едет вниз
 * за своей репликой, когда меняется номер последней (`feedScroll`): у пачки
 * черновиков с одним номером новые вставали бы под край экрана. А целый
 * номер выдал бы черновик за записанную реплику — `↑` открывал бы правку
 * несуществующей, край ленты брался бы с черновика. Поэтому номера делят
 * промежуток между последней записанной и следующим целым.
 *
 * ⚠️ ЗАПИСАННОЕ ПОБЕЖДАЕТ. Догон бывает быстрее ответа на отправку: запись
 * уже в ленте, а черновик ещё в очереди — показывать оба нельзя.
 *
 * Лента не в конце — черновиков нет: их место у живого края, а не внизу
 * давнего отрезка.
 */
export function withDrafts(
  feed: Local[],
  outgoing: readonly Outgoing[],
  conversationId: string | null | undefined,
  atEnd: boolean,
): Local[] {
  const written = new Set(feed.map((one) => one.clientMsgId));
  const mine = atEnd
    ? outgoing.filter(
        (one) => one.conversationId === conversationId && !written.has(one.clientMsgId),
      )
    : [];
  if (mine.length === 0) return feed;
  const last = maxSeq(feed.filter((one) => Number.isInteger(one.seq)));
  const step = 1 / (mine.length + 1);
  return [...feed, ...mine.map((one, i) => draftOf(one, last + (i + 1) * step))];
}

function draftOf(item: Outgoing, seq: number): Local {
  return {
    // ⚠️ ИМЯ ЧЕРНОВИКА — ЕГО КЛЮЧ. Настоящий `id` приедет с сервера, а узел
    // строки держится за `clientMsgId` (`keyOf`) и при замене не пересоздаётся.
    id: item.clientMsgId,
    clientMsgId: item.clientMsgId,
    conversationId: item.conversationId,
    body: item.body,
    kind: "human",
    seq,
    createdAt: item.createdAt,
    editedAt: null,
    pinnedAt: null,
    replyTo: item.replyTo,
    forwardedFrom: null,
    author: item.author,
    state: item.state,
  };
}

/** Одна очередь на вкладку. */
export const sendQueue = new SendQueue({
  send: (item, signal) =>
    api.send(
      item.conversationId,
      item.body,
      item.clientMsgId,
      item.replyTo ? { replyToId: item.replyTo.id } : {},
      signal,
    ),
  ask: (item) => api.ask(item.conversationId, item.scope),
  remove: (messageId) => api.remove(messageId),
  now: Date.now,
  random: Math.random,
  sleep: (ms) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)),
  limit: (ms) => AbortSignal.timeout(ms),
});
