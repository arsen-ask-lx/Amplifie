import { useCallback, useState } from "react";
import { api, type Conversation, type Project } from "./api.js";
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
  /** Проекты, в которых человеку виден хоть один чат (Р-032). */
  projects: Project[];
  /** Перечитать. Возвращает то же, что положил в состояние. */
  reload: () => Promise<Conversation[]>;
  /**
   * Завести канал. `projectId` — сразу внутрь проекта (task-035).
   *
   * ⚠️ ОДНА ФУНКЦИЯ С НЕОБЯЗАТЕЛЬНЫМ ДОВОДОМ, А НЕ ДВЕ. «Завести канал»
   * и «завести канал в проекте» — одно знание с разной подробностью;
   * двумя функциями они разъехались бы на первой правке, и одна из них
   * перестала бы, скажем, открывать заведённое.
   */
  addChannel: (title: string, projectId?: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  addThread: (title: string) => Promise<void>;
  /** Завести проект. */
  addProject: (title: string) => Promise<void>;
  /** Отнести чат к проекту либо снять принадлежность (`null`). */
  moveToProject: (conversationId: string, projectId: string | null) => Promise<void>;
}

export function useRooms(where: Address): Rooms {
  const [items, setItems] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { currentId, currentIdRef, navigate } = where;

  const reload = useCallback(async () => {
    const { items: fresh, projects: папки } = await api.conversations();
    setItems(fresh);
    setProjects(папки ?? []);
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
    async (title: string, projectId?: string) => {
      await openNew(() => api.createChannel(title, projectId));
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

  /**
   * Завести проект.
   *
   * ⚠️ ПРОЕКТ НЕ ОТКРЫВАЕТСЯ ПОСЛЕ ЗАВЕДЕНИЯ, в отличие от канала:
   * открывать нечего — у проекта нет ленты. Панель просто перечитывается,
   * и пустая папка появляется в ней.
   */
  const addProject = useCallback(
    async (title: string) => {
      await api.addProject(title);
      await reload();
    },
    [reload],
  );

  const moveToProject = useCallback(
    async (conversationId: string, projectId: string | null) => {
      await api.moveConversation(conversationId, projectId);
      await reload();
    },
    [reload],
  );

  return {
    items,
    projects,
    reload,
    addChannel,
    removeChannel,
    addThread,
    addProject,
    moveToProject,
  };
}
