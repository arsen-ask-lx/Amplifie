import type { Action } from "../agent/answering/envelope.js";
import { appendEvent } from "../kernel/journal/index.js";
import type { Viewer } from "../kernel/talk/index.js";
import { decide, propose } from "../kernel/work/index.js";
import { db } from "../platform/db.js";

/**
 * Агент делает то, о чём его попросили (task-009, Р-017).
 *
 * ЗДЕСЬ ПРОХОДИТ РУБЕЖ КОМАНД, и он держится архитектурой, а не разбором
 * текста:
 *
 *   ① сюда попадают только действия, предложенные в ответ на ОБРАЩЕНИЕ
 *      человека — это решает вызывающий (`awaitsAnswer`);
 *   ② ответственный и цитата берутся от ОБРАТИВШЕГОСЯ и ниоткуда больше.
 *      Полей «ответственный» и «сообщение» из вывода модели здесь просто
 *      нет — их некуда прочитать, даже если модель их прислала;
 *   ③ подтверждает человек. `decide` отвергает всех, у кого
 *      `kind !== "human"`, поэтому агент не может подтвердить сам —
 *      не по договорённости, а потому что не пройдёт проверку.
 *
 * Задача рождается по СУЩЕСТВУЮЩЕМУ пути: агент предлагает
 * договорённость, обратившийся её подтверждает — его обращение и есть
 * подтверждение. Гейт К4 остаётся нетронутым.
 */

/** Что сделали и что не смогли. Идёт в ответ агента и в журнал. */
export interface Done {
  /** Названия заведённых задач — их агент назовёт человеку в ленте. */
  made: string[];
  /** Сколько предложений не выполнено. Молча ронять их нельзя. */
  dropped: number;
}

/**
 * Выполнить действия от имени агента.
 *
 * `asker` — тот, кто обратился. Он же ответственный, он же автор цитаты,
 * он же подтверждающий. Три роли одного человека, и это не совпадение:
 * действие принадлежит тому, кто его попросил.
 */
export async function doActions(
  asker: Viewer & { kind: string },
  agentParticipantId: string,
  conversationId: string,
  askingMessage: { id: string; body: string },
  actions: Action[],
): Promise<Done> {
  const made: string[] = [];
  let dropped = 0;

  for (const action of actions) {
    if (action.kind !== "создать-задачу") {
      dropped++;
      continue;
    }

    // Договорённость предлагает АГЕНТ — у предложения должен быть автор.
    // Цитата указывает на сообщение обратившегося: задача всегда ссылается
    // на ту реплику, которой её попросили.
    const [proposed] = await propose(
      { workspaceId: asker.workspaceId, participantId: agentParticipantId },
      conversationId,
      [{ messageId: askingMessage.id, quote: askingMessage.body, text: action.text }],
    );

    if (!proposed) {
      // Такая договорённость уже была: повторный зов ничего не заводит.
      // Отпечаток строится по сообщению-обращению, поэтому двойной клик
      // не даёт второй задачи.
      dropped++;
      continue;
    }

    // Подтверждает ЧЕЛОВЕК. Агент сюда не пройдёт: `decide` требует
    // kind === "human", и это ограничение старше этой задачи.
    await decide(asker, proposed, "confirm");
    made.push(action.text);
  }

  await appendEvent(db, {
    kind: "agent.acted",
    workspaceId: asker.workspaceId,
    actorParticipantId: agentParticipantId,
    subjectType: "conversation",
    subjectId: conversationId,
    // Числа и виды, без текста задач: журнал читается шире разговора.
    payload: { made: made.length, dropped, kinds: actions.map((one) => one.kind) },
  });

  return { made, dropped };
}
