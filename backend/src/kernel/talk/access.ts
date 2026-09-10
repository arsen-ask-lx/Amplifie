import type { Executor } from "../../platform/db.js";
import * as repo from "./repo.js";

/**
 * Кто пришёл и видит ли он этот разговор.
 *
 * ⚠️ СВОЙ ФАЙЛ, ПОТОМУ ЧТО ОТВЕТ НУЖЕН ДВОИМ. На вопрос «видно или нет»
 * опирается и работа с репликами, и упоминания; жила проверка в службе,
 * и модуль упоминаний не мог её позвать, не замкнув круг импортов.
 * Круг ломается выносом общего вниз, а не вторым экземпляром проверки:
 * два ответа на вопрос о ПРАВАХ — это дыра, которая однажды разойдётся.
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
  // Проверка арендатора остаётся, хотя членство её почти всегда покрывает:
  // это последний рубеж на случай, если участник когда-нибудь окажется
  // в разговоре чужого пространства.
  if (!found || found.workspaceId !== viewer.workspaceId) {
    throw new ConversationNotVisibleError();
  }
  return found;
}
