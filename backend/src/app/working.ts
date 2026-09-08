import { BREAKER } from "@amplifie/contract";
import { WORK_SYSTEM } from "../agent/answering/prompt.js";
import { ensureAgent } from "../kernel/identity/index.js";
import { createTaskDiscussion, sendAsAgent, type Viewer } from "../kernel/talk/index.js";
import {
  markRun,
  oneTaskFor,
  patchTask,
  setDiscussion,
  TaskNotVisibleError,
} from "../kernel/work/index.js";
import { askThroughSources } from "./answering.js";

/**
 * Агент берёт задачу и делает её (task-011).
 *
 * ЗАПУСКАЕТ ЧЕЛОВЕК, ПЛАТИТ ЧЕЛОВЕК. Модель зовётся через настройку
 * нажавшего (Р-016). Агент сам себя не запускает: иначе доска
 * превратилась бы в счётчик расходов, который никто не заводил.
 *
 * ⚠️ РАЗМЫКАТЕЛЬ. Два отказа ПОДРЯД по одной задаче — к человеку,
 * а не третья попытка. Правило проекта требует три; здесь строже
 * намеренно: у каждой попытки цена в деньгах и секундах, а третья почти
 * никогда не отличается от второй. Разомкнутый размыкатель отвечает
 * ДО обращения к модели — иначе это не размыкатель, а счётчик.
 *
 * ⚠️ ИНСТРУМЕНТОВ У ПРОГОНА НЕТ. Он умеет только написать текст
 * в обсуждение. Это граница архитектуры, а не просьба в подсказке.
 */

/** Задача не годится для прогона: исполнитель не агент. */
export class NotAgentTaskError extends Error {}

/** Размыкатель разомкнут: нужен человек, а не третья попытка. */
export class BreakerOpenError extends Error {}

export interface RunResult {
  taskId: string;
  discussionId: string;
  ms: number;
}

/**
 * Что агент получает на вход. Название задачи — единственное поручение.
 *
 * Раньше сюда добавлялись цитаты договорённости, из которой родилась
 * задача. Договорённостей больше нет, и поручение стало короче: одна
 * строка, которую написал человек.
 */
function briefFor(task: { title: string }): string {
  return `Задача: ${task.title}`;
}

/**
 * Сделать задачу.
 *
 * Отказ модели засчитывается в размыкатель и пробрасывается: человек
 * должен увидеть причину, а не «что-то пошло не так».
 */
export async function runTask(
  actor: Viewer & { kind: string },
  taskId: string,
): Promise<RunResult> {
  const task = await oneTaskFor(actor.workspaceId, taskId);
  if (!task) throw new TaskNotVisibleError();

  if (task.assignedTo?.kind !== "agent") {
    throw new NotAgentTaskError("прогон бывает только у задачи, назначенной на агента");
  }
  if (task.failedRuns >= BREAKER) {
    // ДО обращения к модели. Иначе размыкатель не размыкает, а считает.
    throw new BreakerOpenError(`${task.failedRuns} отказа подряд — дальше нужен человек`);
  }

  const agent = await ensureAgent(actor.workspaceId);

  // Обсуждение заводится при ПЕРВОМ прогоне: у задачи, которую никто
  // не трогал, обсуждать нечего.
  const discussionId =
    task.discussionId ?? (await createTaskDiscussion(actor, `Задача: ${task.title}`)).id;
  if (!task.discussionId) await setDiscussion(actor.workspaceId, taskId, discussionId);

  let answer: { text: string; ms: number };
  try {
    answer = await askThroughSources(actor, WORK_SYSTEM, briefFor(task));
  } catch (error) {
    await markRun(actor, taskId, "отказ", { reason: nameOf(error) });
    throw error;
  }

  // Результат — обычное сообщение агента: тот же вид и та же недоверенность,
  // что у ответа в чате. Текст модели не становится доверенным оттого,
  // что его попросили сделать работу.
  await sendAsAgent(actor, agent.id, discussionId, {
    body: answer.text,
    // Ключ идемпотентности от задачи и попытки: повтор того же прогона
    // не задваивает запись.
    clientMsgId: crypto.randomUUID(),
  });

  await patchTask({ ...actor, kind: actor.kind }, taskId, { stage: "на проверке" });
  await markRun(actor, taskId, "успех", { ms: answer.ms, chars: answer.text.length });

  return { taskId, discussionId, ms: answer.ms };
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "unknown";
}
