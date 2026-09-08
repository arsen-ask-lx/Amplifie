import { useMatch } from "react-router";
import type { Work } from "../data/useWork.js";
import { Board } from "./Board.js";

/**
 * Доска задач — и ничего больше.
 *
 * ⚠️ ЗДЕСЬ БЫЛА ЕЩЁ ОЧЕРЕДЬ РЕШЕНИЙ — «договорённости, которые ждут
 * человека». Она убрана владельцем целиком вместе с самими
 * договорённостями (2026-09-07). Доска отвечает на один вопрос:
 * что в работе и на какой стадии.
 */
export function BoardScreen({ work, meId }: { work: Work; meId: string }) {
  // `/board/:taskId` — ссылка на конкретную задачу (Р-019). Через `useMatch`,
  // а не `useParams`: экран живёт выше любого `<Route>`.
  const named = useMatch("/board/:taskId")?.params.taskId ?? null;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {work.failure ? (
        <p className="mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
          {work.failure}
        </p>
      ) : null}

      <Board
        tasks={work.tasks}
        people={work.people}
        meId={meId}
        namedId={named}
        onPatched={work.applyTask}
        onListChanged={work.reloadTasks}
      />
    </div>
  );
}
