/**
 * Шина звонков «в пространстве что-то изменилось» (Р-006).
 *
 * ЧТО ОНА НЕ ДЕЛАЕТ. Не переносит содержимое. Звонок — это ровно факт
 * изменения; содержимое клиент забирает через `/v1/sync`, где права и
 * бездырочный порядок уже написаны и проверены. Второй путь доставки
 * разошёлся бы с первым, и разошёлся бы молча.
 *
 * ГДЕ ОНА ЖИВЁТ. В памяти процесса, потому что узел один. Порог, на котором
 * это перестаёт работать, назван заранее: **второй узел приложения**.
 * Тогда шина уезжает в `LISTEN/NOTIFY` Postgres или в брокер, а этот файл
 * становится её местной частью. Интерфейс подобран так, чтобы переезд
 * не задел ни ядро, ни витрину.
 *
 * ПОЧЕМУ НЕ EventEmitter ИЗ NODE. Он молча терпит утечку подписчиков и
 * ругается только на десятом. Здесь подписки живут ровно столько, сколько
 * открыт поток, и их число — предмет наблюдения, а не догадок.
 */

type Listener = () => void;

const byWorkspace = new Map<string, Set<Listener>>();

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
 * Подписаться на изменения пространства. Возвращает отписку —
 * вызвать обязательно, иначе подписчик переживёт закрытый поток.
 */
export function subscribe(workspaceId: string, listener: Listener): () => void {
  let listeners = byWorkspace.get(workspaceId);
  if (!listeners) {
    listeners = new Set();
    byWorkspace.set(workspaceId, listeners);
  }
  listeners.add(listener);

  return () => {
    const current = byWorkspace.get(workspaceId);
    if (!current) return;
    current.delete(listener);
    // Пустое множество удаляем: иначе карта растёт по числу пространств,
    // которые когда-либо кто-то слушал, и не уменьшается никогда.
    if (current.size === 0) byWorkspace.delete(workspaceId);
  };
}

/**
 * Позвонить всем, кто слушает пространство.
 *
 * ⚠️ Вызывать ТОЛЬКО после фиксации транзакции. Звонок до фиксации отправит
 * клиента в `/v1/sync`, где он ничего нового не увидит, — а второго звонка
 * не будет, и изменение доедет только со следующим.
 *
 * Ошибка одного слушателя не должна мешать остальным и не должна ронять
 * запись, которая только что прошла: звонок — дело второе после факта.
 */
export function publish(workspaceId: string): void {
  const listeners = byWorkspace.get(workspaceId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      onListenerFailed(error);
    }
  }
}

/** Сколько подписчиков сейчас держим — для наблюдения за утечкой. */
export function subscriberCount(): number {
  let total = 0;
  for (const listeners of byWorkspace.values()) total += listeners.size;
  return total;
}
