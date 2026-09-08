import type { Action } from "../agent/answering/envelope.js";
import { appendEvent } from "../kernel/journal/index.js";
import type { Viewer } from "../kernel/talk/index.js";
import { createTask } from "../kernel/work/index.js";
import { db } from "../platform/db.js";

/**
 * Агент делает то, о чём его попросили (task-009, Р-017).
 *
 * ЗДЕСЬ ПРОХОДИТ РУБЕЖ КОМАНД, и он держится архитектурой, а не разбором
 * текста:
 *
 *   ① сюда попадают только действия, предложенные в ответ на ОБРАЩЕНИЕ
 *      человека — это решает вызывающий (`awaitsAnswer`);
 *   ② ответственным становится ОБРАТИВШИЙСЯ и никто другой. Поля
 *      «ответственный» из вывода модели здесь просто нет — его некуда
 *      прочитать, даже если модель его прислала.
 *
 * ⚠️ ПОДТВЕРЖДЕНИЯ БОЛЬШЕ НЕТ, И ЭТО НЕ ОСЛАБЛЕНИЕ. Раньше задача
 * рождалась через договорённость: агент предлагал, человек подтверждал.
 * Договорённости убраны владельцем целиком. Гейт подтверждения имел смысл
 * там, где агент решал САМ, что услышал; когда человек прямо написал
 * «заведи задачу», подтверждать нечего — обращение и есть решение.
 *
 * Рубеж команд от этого не пострадал: он держится тем, что сюда вообще
 * не попадает ничего, кроме ответа на явное обращение человека.
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
 * `asker` — тот, кто обратился. Он же ответственный: действие принадлежит
 * тому, кто его попросил.
 */
export async function doActions(
  asker: Viewer & { kind: string },
  agentParticipantId: string,
  conversationId: string,
  actions: Action[],
): Promise<Done> {
  const made: string[] = [];
  let dropped = 0;

  for (const action of actions) {
    if (action.kind !== "создать-задачу") {
      dropped++;
      continue;
    }

    // Ответственный — обратившийся. Проверку «ответственный это человек»
    // держит база (составной ключ на `participant (id, kind)`), поэтому
    // агент не смог бы записать ответственным себя, даже если бы захотел.
    await createTask(asker, { title: action.text, responsibleId: asker.participantId });
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
