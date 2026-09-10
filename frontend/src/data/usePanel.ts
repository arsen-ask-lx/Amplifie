import { useMemo } from "react";
import type { Conversation, Project } from "./api.js";
import type { Reading } from "./useReading.js";
import type { Rooms } from "./useRooms.js";

/**
 * Боковая панель одним предметом (task-035, шаг 0).
 *
 * ⚠️ ЗАВЕДЕНО НЕ РАДИ КРАСОТЫ, А ПО ЗАМЕРУ. Упоминания тронули восемь
 * файлов, проекты — девять, и в обоих случаях половина правок была
 * не про дело, а про ПРОБРОС нового свойства через `Rail → RoomList →
 * ChannelRow`. У панели было девять отдельных свойств; каждое её новое
 * умение стоило трёх файлов, из которых два не знали, зачем их правят.
 *
 * Теперь у панели один предмет. Прибавилось умение — прибавилось поле
 * здесь, и `Rail` об этом не узнаёт вовсе: он передаёт целое.
 *
 * ⚠️ ЭТО СБОРКА, А НЕ НОВОЕ ЗНАНИЕ. Ни одного состояния тут нет и быть
 * не должно: список живёт в `useRooms`, прочитанное — в `useReading`,
 * «где я» — в адресе (Р-019). Заведи здесь хоть одно своё поле — и оно
 * станет вторым ответом на вопрос, у которого уже есть первый.
 */
export interface Panel {
  /** Корневые разговоры. Ветки в панели не живут — они внутри канала. */
  items: Conversation[];
  /** Проекты, в которых человеку виден хоть один чат (Р-032). */
  projects: Project[];
  currentId: string | null;
  /** Сколько чужих реплик человек тут не видел (Р-029). */
  unreadOf: (conversationId: string) => number;
  /** Сколько раз тут позвали его самого и он этого не видел (Р-031). */
  mentionsOf: (conversationId: string) => number;
  select: (conversationId: string) => void;
  /** Завести канал. `projectId` — сразу внутрь проекта. */
  addChannel: (title: string, projectId?: string) => Promise<void>;
  addProject: (title: string) => Promise<void>;
  /** Отнести чат к проекту либо снять принадлежность (`null`). */
  moveToProject: (conversationId: string, projectId: string | null) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
}

export function usePanel(input: {
  rooms: Rooms;
  reading: Reading;
  currentId: string | null;
  select: (id: string) => void;
}): Panel {
  const { rooms, reading, currentId, select } = input;

  return useMemo(
    () => ({
      /**
       * ⚠️ ОТБОР КОРНЕВЫХ ЖИВЁТ ЗДЕСЬ, А НЕ В РАЗМЕТКЕ. Он был в самой
       * панели строкой `rooms.filter(...)`, и это знание — «что панель
       * показывает» — оказывалось в файле про то, «как она выглядит».
       */
      items: rooms.items.filter((room) => room.parentId === null),
      projects: rooms.projects,
      currentId,
      unreadOf: reading.unreadOf,
      mentionsOf: reading.mentionsOf,
      select,
      addChannel: rooms.addChannel,
      addProject: rooms.addProject,
      moveToProject: rooms.moveToProject,
      removeChannel: rooms.removeChannel,
    }),
    [rooms, reading, currentId, select],
  );
}
