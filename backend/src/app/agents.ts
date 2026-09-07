import { listAgents, listBridges } from "../kernel/identity/index.js";
import type { Viewer } from "../kernel/talk/index.js";

/**
 * Что показать в разделе «Агенты» (task-007).
 *
 * ДВА ВОПРОСА ЧЕЛОВЕКА, НА КОТОРЫЕ ЗДЕСЬ ОТВЕЧАЮТ: кто у меня есть
 * и почему он молчит. Второй ответ — про МОЙ мост: агент отвечает через
 * подписку того, кто позвал (task-006). Поэтому состояние моста лежит
 * рядом со списком, а не в отдельном экране настроек: молчание агента
 * и погашенный мост — это одно и то же событие, увиденное с двух сторон.
 *
 * ⚠️ Мост в ответе — ВСЕГДА СПРАШИВАЮЩЕГО. Показать чужой значит соврать
 * человеку про то, чем он платит.
 */

interface AgentView {
  id: string;
  name: string;
  kind: "agent";
  /** Когда агент подаёт голос. Пока способ один — прямое обращение. */
  answersOn: "обращение";
}

interface MyBridge {
  /** Мост заведён и подключён хоть раз. */
  connected: boolean;
  /** Машина на связи прямо сейчас — только тогда агент способен ответить. */
  online: boolean;
  name: string | null;
}

export interface AgentsView {
  items: AgentView[];
  bridge: MyBridge;
}

/** Мост, по которому и пойдёт вопрос: свежий из подключённых. */
function mine(rows: Awaited<ReturnType<typeof listBridges>>): MyBridge {
  const joined = rows.filter((one) => one.joined);
  // Тот же выбор, что делает `askOwnBridge`: сперва живой, иначе просто
  // самый свежий. Иначе раздел показывал бы одно, а спрашивал через другое.
  const chosen = joined.find((one) => one.online) ?? joined[0];
  if (!chosen) return { connected: false, online: false, name: null };
  return { connected: true, online: chosen.online, name: chosen.name };
}

export async function agentsFor(viewer: Viewer): Promise<AgentsView> {
  const [found, bridges] = await Promise.all([
    listAgents(viewer.workspaceId),
    listBridges(viewer.participantId),
  ]);

  return {
    items: found.map((one) => ({
      id: one.id,
      name: one.name,
      kind: "agent" as const,
      answersOn: "обращение" as const,
    })),
    bridge: mine(bridges),
  };
}
