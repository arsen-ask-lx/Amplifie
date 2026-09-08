import { useCallback, useEffect, useState } from "react";
import { api, type Participant, type Task } from "./api.js";

/**
 * Данные доски: задачи и участники.
 *
 * ⚠️ ДОГОВОРЁННОСТИ УБРАНЫ (владелец, 2026-09-07). Здесь жила очередь
 * решений — «агент предложил, человек подтверждает» — вместе с ней
 * ушли `agreements`, `deciding` и `decide`.
 *
 * Живёт выше экрана, в `ChatScreen`: доска и чат смотрят на один список.
 * Два держателя одного списка разошлись бы — и разошлись бы молча.
 */

export interface Work {
  tasks: Task[];
  /** Кого можно назначить исполнителем. */
  people: Participant[];
  loading: boolean;
  failure: string | null;
  /** Перечитать задачи и участников. */
  reload: () => Promise<void>;
  /** Перечитать только задачи. Прогон меняет стадию, счётчик и обсуждение. */
  reloadTasks: () => Promise<void>;
  /**
   * Вклеить одну задачу, которую сервер только что вернул.
   *
   * ⚠️ Это НЕ второй источник правды: вклеивается ответ того же сервера,
   * а не собранное из воздуха. До task-012 ход карты по доске стоил трёх
   * запросов — договорённости, задачи и участники разом, — хотя менялась
   * одна строка и участники не менялись вовсе.
   */
  applyTask: (task: Task) => void;
}

export function useWork(): Work {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [done, who] = await Promise.all([api.tasks(), api.participants()]);
      setTasks(done.items);
      setPeople(who.items);
      setFailure(null);
    } catch {
      setFailure("Не удалось загрузить задачи");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadTasks = useCallback(async () => {
    try {
      setTasks((await api.tasks()).items);
    } catch {
      setFailure("Не удалось перечитать задачи");
    }
  }, []);

  const applyTask = useCallback((task: Task) => {
    setTasks((current) => current.map((one) => (one.id === task.id ? task : one)));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    tasks,
    people,
    loading,
    failure,
    reload,
    reloadTasks,
    applyTask,
  };
}
