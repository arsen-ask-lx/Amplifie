import { hear, type Said } from "../agent/listening/detect.js";
import { ensureAgent } from "../kernel/identity/index.js";
import { listMessages, type Viewer } from "../kernel/talk/index.js";
import { propose } from "../kernel/work/index.js";

/**
 * К1–К3 целиком: агент слышит разговор, отличает договорённость
 * от болтовни, формулирует её и кладёт как ПРЕДЛОЖЕННУЮ.
 *
 * Шов проходит здесь, а не внутри ядра: `talk` не знает про работу,
 * `work` не знает про распознавание, `agent/` не знает про хранилище.
 * Заменить распознавание на модель — значит тронуть один файл
 * в `agent/listening`, и ни одного в ядре.
 */

/** Сколько последних реплик слушаем за один разбор. */
const WINDOW = 100;

export async function listenTo(viewer: Viewer, conversationId: string): Promise<number> {
  const feed = await listMessages(viewer, conversationId, WINDOW);

  const said: Said[] = feed.items.map((message) => ({
    id: message.id,
    body: message.body,
    authorName: message.author.name,
    kind: message.author.kind,
  }));

  const heard = hear(said);
  if (heard.length === 0) return 0;

  // Агент — участник пространства, а не безличная машина: у предложения
  // обязан быть автор, иначе журнал не отвечает на вопрос «кто это сказал».
  const agent = await ensureAgent(viewer.workspaceId);

  // `propose` отдаёт идентификаторы заведённых, витрине нужно число.
  const added = await propose(
    { workspaceId: viewer.workspaceId, participantId: agent.id },
    conversationId,
    heard,
  );
  return added.length;
}
