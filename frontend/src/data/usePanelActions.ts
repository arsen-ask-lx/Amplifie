import { useCallback } from "react";
import { api, type Conversation } from "./api.js";

/**
 * Правки панели: завести, убрать, перенести, закрепить (task-098, Д-10).
 *
 * ⚠️ ОТДЕЛЬНО ОТ ТОГО, ЧТО ПАНЕЛЬ ПОКАЗЫВАЕТ. `useRooms` отвечает на вопрос
 * «какие есть разговоры» — грузит, перечитывает, двигает строки по событиям;
 * здесь — «как их меняют». Правка знает о панели одно: после записи её надо
 * перечитать (`settle`), и как именно, решает `useRooms`.
 */

/**
 * Вид папки: значок и цвет (task-038). Пусто — как было.
 *
 * ⚠️ ОТДЕЛЬНЫМ ИМЕНЕМ, А НЕ ДВУМЯ ДОВОДАМИ ПОДРЯД. Значок и цвет ходят
 * только вместе — это одно понятие «как папка выглядит», и в четырёх
 * местах, где оно передаётся, пара не должна разъезжаться.
 */
interface Look {
  icon?: string | null;
  color?: string | null;
}

export interface PanelActions {
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
  addProject: (title: string, look?: Look) => Promise<void>;
  renameProject: (id: string, edit: { title?: string } & Look) => Promise<void>;
  /** Убрать проект. Папка исчезает, переписка остаётся (Р-032). */
  removeProject: (id: string) => Promise<void>;
  /** Отнести чат к проекту либо снять принадлежность (`null`). */
  moveToProject: (conversationId: string, projectId: string | null) => Promise<void>;
  /**
   * Закрепить чат либо проект в своей панели (task-038).
   *
   * ⚠️ ОДНА ФУНКЦИЯ НА ОБА СЛУЧАЯ, потому что это одно умение: «пусть
   * будет наверху». Двумя они разъехались бы на первой правке.
   *
   * ⚠️ ЛИЧНОЕ (Д-32): у коллеги порядок свой. Считает его сервер.
   */
  pin: (
    target: { conversationId: string } | { projectId: string },
    pinned: boolean,
  ) => Promise<void>;
}

export function usePanelActions({
  settle,
  navigate,
  currentId,
  currentIdRef,
  itemsRef,
}: {
  /** Перечитать панель после удачной записи, не дожидаясь (task-096). */
  settle: () => void;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  currentId: string | null | undefined;
  currentIdRef: { current: string | null | undefined };
  /** Загруженные строки на сейчас. */
  itemsRef: { current: Conversation[] };
}): PanelActions {
  /**
   * Завести разговор и открыть его.
   *
   * ⚠️ ПОСЛЕ ЗАВЕДЕНИЯ СПИСОК ПЕРЕЧИТЫВАЕТСЯ ЦЕЛИКОМ, а не дополняется
   * ответом: пока мы набирали название, в пространстве мог появиться
   * и чужой канал. Строку открытого чата привезёт то же перечитывание.
   */
  const openNew = useCallback(
    async (make: () => Promise<Conversation>) => {
      const created = await make();
      settle();
      navigate(`/c/${created.id}`);
    },
    [settle, navigate],
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
      settle();
      if (currentIdRef.current !== id) return;
      const next = itemsRef.current.find((room) => room.parentId === null && room.id !== id);
      navigate(next ? `/c/${next.id}` : "/", { replace: true });
    },
    [settle, navigate, currentIdRef, itemsRef],
  );

  const addThread = useCallback(
    async (title: string) => {
      // Ветка заводится у КОРНЯ: ветка от ветки не бывает (дерево
      // ровно двухуровневое), и сервер такое всё равно отклонит.
      const room = itemsRef.current.find((one) => one.id === currentId);
      const rootId = room?.parentId ?? room?.id;
      if (!rootId) return;
      await openNew(() => api.createThread(rootId, title));
    },
    [currentId, openNew, itemsRef],
  );

  /**
   * Завести проект.
   *
   * ⚠️ ПРОЕКТ НЕ ОТКРЫВАЕТСЯ ПОСЛЕ ЗАВЕДЕНИЯ, в отличие от канала:
   * открывать нечего — у проекта нет ленты. Панель просто перечитывается,
   * и пустая папка появляется в ней.
   */
  const addProject = useCallback(
    async (title: string, look?: Look) => {
      await api.addProject(title, look);
      settle();
    },
    [settle],
  );

  const renameProject = useCallback(
    async (id: string, edit: { title?: string } & Look) => {
      await api.renameProject(id, edit);
      settle();
    },
    [settle],
  );

  /**
   * Убрать проект.
   *
   * ⚠️ ЧАТЫ НИКУДА НЕ ДЕВАЮТСЯ — их возвращает наружу сервер, и панель
   * просто перечитывается. Убирать их здесь руками значило бы завести
   * второй ответ на вопрос «где теперь этот чат».
   */
  const removeProject = useCallback(
    async (id: string) => {
      await api.removeProject(id);
      settle();
    },
    [settle],
  );

  const pin = useCallback(
    async (target: { conversationId: string } | { projectId: string }, pinned: boolean) => {
      await ("conversationId" in target
        ? api.pinConversation(target.conversationId, pinned)
        : api.pinProject(target.projectId, pinned));
      // Порядок пересчитывает сервер — перечитываем панель целиком,
      // а не переставляем строки здесь (иначе про порядок знают двое).
      settle();
    },
    [settle],
  );

  const moveToProject = useCallback(
    async (conversationId: string, projectId: string | null) => {
      await api.moveConversation(conversationId, projectId);
      settle();
    },
    [settle],
  );

  return {
    addChannel,
    removeChannel,
    addThread,
    addProject,
    renameProject,
    removeProject,
    moveToProject,
    pin,
  };
}
