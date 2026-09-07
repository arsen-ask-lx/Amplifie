import { useCallback, useEffect, useState } from "react";
import { type Agreement, api, type Participant, type Task } from "./api.js";

/**
 * Данные экрана работы: договорённости и задачи.
 *
 * Живёт выше экрана, в `ChatScreen`, потому что разбор запускается из шапки
 * разговора, а его результат виден здесь. Два держателя одного списка
 * разошлись бы — и разошлись бы молча.
 */

export interface Work {
  agreements: Agreement[];
  tasks: Task[];
  /** Кого можно назначить исполнителем. */
  people: Participant[];
  loading: boolean;
  failure: string | null;
  /** По какой договорённости сейчас идёт запрос: кнопки на ней гаснут. */
  deciding: string | null;
  /** Перечитать всё. Для решения человека: оно меняет сразу оба списка. */
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
  decide: (id: string, verdict: "confirm" | "reject") => Promise<void>;
}

export function useWork(): Work {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // Оба списка одним заходом: подтверждение меняет сразу и то и другое,
      // а показать новое в одном и старое в другом — хуже, чем подождать.
      const [gathered, done, who] = await Promise.all([
        api.agreements(),
        api.tasks(),
        api.participants(),
      ]);
      setAgreements(gathered.items);
      setTasks(done.items);
      setPeople(who.items);
      setFailure(null);
    } catch {
      setFailure("Не удалось загрузить договорённости");
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

  const decide = useCallback(
    async (id: string, verdict: "confirm" | "reject") => {
      setDeciding(id);
      try {
        await api.decide(id, verdict);
        // Перечитываем целиком, а не правим состояние на месте: подтверждение
        // рождает ещё и задачу, и собирать её здесь из воздуха — значит
        // завести второй источник правды о том, что уже есть на сервере.
        await reload();
      } catch {
        setFailure(
          verdict === "confirm"
            ? "Подтвердить не удалось — договорённость осталась предложенной"
            : "Отклонить не удалось — договорённость осталась предложенной",
        );
      } finally {
        setDeciding(null);
      }
    },
    [reload],
  );

  return {
    agreements,
    tasks,
    people,
    loading,
    failure,
    deciding,
    reload,
    reloadTasks,
    applyTask,
    decide,
  };
}
