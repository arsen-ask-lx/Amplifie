import { useMemo } from "react";
import type { Conversation } from "./api.js";
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
 *
 * ⚠️ ДЕЙСТВИЯ ВЗЯТЫ ИЗ `Rooms` ПО ИМЕНАМ, А НЕ ПЕРЕПИСАНЫ. Прежде здесь
 * стояла дословная копия их объявлений — гейт повторов нашёл её,
 * а копия уже успела потерять описание одного из полей.
 */
export interface Panel
  extends Pick<
    Rooms,
    | "projects"
    | "addChannel"
    | "addProject"
    | "renameProject"
    | "removeProject"
    | "moveToProject"
    | "pin"
    | "removeChannel"
  > {
  /** Корневые разговоры. Ветки в панели не живут — они внутри канала. */
  items: Conversation[];
  currentId: string | null;
  /** Сколько чужих реплик человек тут не видел (Р-029). */
  unreadOf: (conversationId: string) => number;
  /** Сколько раз тут позвали его самого и он этого не видел (Р-031). */
  mentionsOf: (conversationId: string) => number;
  select: (conversationId: string) => void;
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
      renameProject: rooms.renameProject,
      removeProject: rooms.removeProject,
      moveToProject: rooms.moveToProject,
      pin: rooms.pin,
      removeChannel: rooms.removeChannel,
    }),
    [rooms, reading, currentId, select],
  );
}
