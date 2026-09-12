import type { Executor } from "../../platform/db.js";
import * as repo from "./repo.js";

/**
 * Кто пришёл и видит ли он этот разговор. Отдельным файлом, чтобы службе
 * и упоминаниям хватало одной проверки без круга импортов.
 */

/** Разговора нет ЛИБО он тебе не виден — снаружи это одно и то же. */
export class ConversationNotVisibleError extends Error {}

export interface Viewer {
  participantId: string;
  workspaceId: string;
}

/**
 * Проверка доступа. Единственная точка, где решается «видно или нет».
 *
 * Право читается у КОРНЯ дерева разговоров: у ветки своих участников нет
 * (dock/06-разбор-мессенджеров.md). Не найдено и не видно — одна и та же
 * ошибка, чтобы по ответу нельзя было перебрать существующие разговоры.
 */
export async function requireVisible(tx: Executor, viewer: Viewer, conversationId: string) {
  const found = await repo.findVisibleConversation(tx, conversationId, viewer.participantId);
  // Последний рубеж арендатора: членство почти всегда это покрывает, но не по построению.
  if (!found || found.workspaceId !== viewer.workspaceId) {
    throw new ConversationNotVisibleError();
  }
  return found;
}
