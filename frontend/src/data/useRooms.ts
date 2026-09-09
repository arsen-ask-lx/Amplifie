import { useCallback, useState } from "react";
import { api, type Conversation } from "./api.js";
import type { Address } from "./useAddress.js";

/**
 * Список каналов и всё, что с ним делают.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `useChat` ПО ЗНАНИЮ, А НЕ ПО РАЗМЕРУ (Д-10, task-020).
 * Здесь «какие есть разговоры и как их заводят»; там — «что показывать
 * в открытом». Лента про список не спрашивает, список про ленту не знает,
 * и держать их вместе значило читать одно ради правки другого.
 *
 * ⚠️ СПИСОК ВСЕГДА ПЕРЕЧИТЫВАЕТСЯ, А НЕ ПРАВИТСЯ НА МЕСТЕ. Порядок
 * по свежести и связи веток с корнями сервер уже умеет собирать
 * правильно; второе такое место на клиенте разошлось бы с ним. Один
 * лишний запрос дешевле двух источников правды.
 */

export interface Rooms {
  items: Conversation[];
  /** Перечитать. Возвращает то же, что положил в состояние. */
  reload: () => Promise<Conversation[]>;
  addChannel: (title: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  addThread: (title: string) => Promise<void>;
}

export function useRooms(where: Address): Rooms {
  const [items, setItems] = useState<Conversation[]>([]);
  const { currentId, currentIdRef, navigate } = where;

  const reload = useCallback(async () => {
    const { items: fresh } = await api.conversations();
    setItems(fresh);
    return fresh;
  }, []);

  /**
   * Завести разговор и открыть его.
   *
   * ⚠️ ПОСЛЕ ЗАВЕДЕНИЯ СПИСОК ПЕРЕЧИТЫВАЕТСЯ ЦЕЛИКОМ, а не дополняется
   * ответом: пока мы набирали название, в пространстве мог появиться
   * и чужой канал.
   */
  const openNew = useCallback(
    async (make: () => Promise<Conversation>) => {
      const created = await make();
      await reload();
      navigate(`/c/${created.id}`);
    },
    [reload, navigate],
  );

  const addChannel = useCallback(
    async (title: string) => {
      await openNew(() => api.createChannel(title));
    },
    [openNew],
  );

  /**
   * Удалить канал.
   *
   * ⚠️ ЕСЛИ УДАЛИЛИ ТОТ, ЧТО ОТКРЫТ, — уводим на первый оставшийся.
   * Остаться на адресе снесённого канала значит показать «Загружаем…»
   * навсегда: сервер о нём больше не расскажет.
   */
  const removeChannel = useCallback(
    async (id: string) => {
      await api.removeChannel(id);
      const fresh = await reload();
      if (currentIdRef.current !== id) return;
      const next = fresh.find((room) => room.parentId === null);
      navigate(next ? `/c/${next.id}` : "/", { replace: true });
    },
    [reload, navigate, currentIdRef],
  );

  const addThread = useCallback(
    async (title: string) => {
      // Ветка заводится у КОРНЯ: ветка от ветки не бывает (дерево
      // ровно двухуровневое), и сервер такое всё равно отклонит.
      const room = items.find((one) => one.id === currentId);
      const rootId = room?.parentId ?? room?.id;
      if (!rootId) return;
      await openNew(() => api.createThread(rootId, title));
    },
    [items, currentId, openNew],
  );

  return { items, reload, addChannel, removeChannel, addThread };
}
