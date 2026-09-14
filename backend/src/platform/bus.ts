/**
 * Шина звонков «изменилось вот здесь» (Р-006, уточнён task-067).
 *
 * ЧТО ОНА НЕСЁТ. Факт изменения и **адрес** — идентификатор разговора.
 * Ни текста, ни автора, ни времени: содержимое клиент забирает через
 * `/v1/sync`, где права и бездырочный порядок уже написаны и проверены.
 * Второй путь доставки разошёлся бы с первым, и разошёлся бы молча.
 *
 * ЗАЧЕМ АДРЕС, ЕСЛИ Р-006 ТРЕБОВАЛ ПУСТОГО ЗВОНКА. Пустой звонок поднимал
 * ВСЕ вкладки пространства, и каждая шла в базу: замерено 154 транзакции
 * на одну реплику при ста вкладках (`make db-per-event`). Адрес — не
 * содержимое, а способ не беспокоить того, кого изменение не касается.
 * Развилка вынесена владельцу и снята им 14.09.2026.
 *
 * ⚠️ ОБЯЗАННОСТЬ, КОТОРОЙ У ПУСТОГО ЗВОНКА НЕ БЫЛО. Адрес закрытого
 * разговора — сведение о нём. Поэтому звонок уходит только тем, кому этот
 * разговор виден; кто решает — знает ядро, а не платформа, и оно даёт
 * разрешитель адресатов. Пока разрешитель не подключён, шина молчит
 * и жалуется: отказ в эту сторону теряет живое обновление, отказ
 * в другую — выдаёт чужую переписку.
 *
 * ГДЕ ОНА ЖИВЁТ. В памяти процесса, потому что узел один. Порог, на котором
 * это перестаёт работать, назван заранее: **второй узел приложения**.
 * Тогда шина уезжает в `LISTEN/NOTIFY` Postgres или в брокер, а этот файл
 * становится её местной частью. По шине и тогда пойдёт только адрес —
 * ограничение `NOTIFY` в 8000 байт этому не помеха (Р-038).
 *
 * ПОЧЕМУ НЕ EventEmitter ИЗ NODE. Он молча терпит утечку подписчиков и
 * ругается только на десятом. Здесь подписки живут ровно столько, сколько
 * открыт поток, и их число — предмет наблюдения, а не догадок.
 */

/** Что случилось: адрес разговора либо `null` — «изменилось пространство». */
export interface Change {
  conversation: string | null;
}

type Listener = (change: Change) => void;

/** Место у потока: кто слушает — нужно, чтобы решить, звонить ли ему. */
interface Seat {
  participantId: string;
  listener: Listener;
}

const byWorkspace = new Map<string, Set<Seat>>();

/**
 * Куда сообщать, если слушатель упал. Заглушка по умолчанию НЕ молчит:
 * сюда попадает только сломанный поток, и молчание о нём — тихий отказ.
 * emitWarning, а не console: platform не знает, чем логирует витрина.
 */
let onListenerFailed: (error: unknown) => void = (error) => {
  process.emitWarning(`слушатель звонка упал: ${String(error)}`, "AmplifieBus");
};

export function setBusFailureReporter(report: (error: unknown) => void): void {
  onListenerFailed = report;
}

/**
 * Кому виден разговор: `null` — всем в пространстве, иначе список людей.
 *
 * Ставится ядром при сборке приложения: платформа не знает правил видимости
 * и не должна — гейт границ поймал бы обратный импорт.
 */
type Audience = (conversationId: string) => Promise<string[] | null>;

let resolveAudience: Audience = async () => {
  onListenerFailed(new Error("разрешитель адресатов не подключён — звонки не уходят"));
  // Закрываемся, а не открываемся: молчащий поток заметят тесты и люди,
  // а утёкший адрес закрытого разговора не заметит никто.
  return [];
};

export function setAudienceResolver(resolve: Audience): void {
  resolveAudience = resolve;
}

/**
 * Подписаться на изменения пространства. Возвращает отписку —
 * вызвать обязательно, иначе подписчик переживёт закрытый поток.
 */
export function subscribe(
  workspaceId: string,
  participantId: string,
  listener: Listener,
): () => void {
  let seats = byWorkspace.get(workspaceId);
  if (!seats) {
    seats = new Set();
    byWorkspace.set(workspaceId, seats);
  }
  const seat: Seat = { participantId, listener };
  seats.add(seat);

  return () => {
    const current = byWorkspace.get(workspaceId);
    if (!current) return;
    current.delete(seat);
    // Пустое множество удаляем: иначе карта растёт по числу пространств,
    // которые когда-либо кто-то слушал, и не уменьшается никогда.
    if (current.size === 0) byWorkspace.delete(workspaceId);
  };
}

/**
 * Позвонить тем, кого изменение касается.
 *
 * ⚠️ Вызывать ТОЛЬКО после фиксации транзакции. Звонок до фиксации отправит
 * клиента в `/v1/sync`, где он ничего нового не увидит, — а второго звонка
 * не будет, и изменение доедет только со следующим.
 *
 * ⚠️ АДРЕСАТЫ СЧИТАЮТСЯ ОДИН РАЗ НА ИЗМЕНЕНИЕ, а не на слушателя. В этом
 * весь смысл работы: на изменение приходится один вопрос к базе вместо
 * одного на каждую открытую вкладку.
 *
 * Ошибка одного слушателя не должна мешать остальным и не должна ронять
 * запись, которая только что прошла: звонок — дело второе после факта.
 */
export async function publish(workspaceId: string, change: Change): Promise<void> {
  const seats = byWorkspace.get(workspaceId);
  if (!seats || seats.size === 0) return;

  const allowed = await allowedFor(change);
  // Выяснить не удалось — не звоним никому: см. разрешитель выше.
  if (allowed === undefined) return;

  for (const seat of [...seats]) {
    if (allowed !== null && !allowed.has(seat.participantId)) continue;
    try {
      seat.listener(change);
    } catch (error) {
      onListenerFailed(error);
    }
  }
}

/**
 * Кому можно звонить: `null` — всем, множество — только этим,
 * `undefined` — выяснить не удалось, значит никому.
 */
async function allowedFor(change: Change): Promise<Set<string> | null | undefined> {
  if (change.conversation === null) return null;
  try {
    const audience = await resolveAudience(change.conversation);
    return audience === null ? null : new Set(audience);
  } catch (error) {
    onListenerFailed(error);
    return undefined;
  }
}
