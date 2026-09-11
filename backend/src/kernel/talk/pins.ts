import { and, eq } from "drizzle-orm";
import { withTransaction } from "../../platform/db.js";
import { requireVisible, type Viewer } from "./access.js";
import { requireProject } from "./projects.js";
import { pin } from "./schema.js";

/**
 * Закрепление в панели — личный взгляд человека на список (task-038).
 *
 * ⚠️ ЛИЧНОЕ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (Д-32, 10.09). «Что у меня наверху»
 * — про мой сегодняшний рабочий день, а не про устройство компании.
 * Общим оно значило бы «это главный проект фирмы», и тогда пришлось бы
 * решать, кому можно переставлять панель всем.
 *
 * ⚠️ ЗВОНКА ПО ШИНЕ ЗДЕСЬ НЕТ, И ЭТО НАМЕРЕННО. `publish` будит ВСЕ
 * вкладки пространства (Р-006), а закрепление не меняет ничего, что
 * видит кто-то ещё. Разбудить всех ради своей булавки — это шум,
 * умноженный на число людей.
 *
 * ⚠️ И В ЖУРНАЛ НЕ ПИШЕМ — единственное отступление от Р-2 во всём
 * ядре, названное вслух здесь и в плане task-038 §9. Журнал отвечает
 * на вопрос «кто изменил общее состояние»; закрепление общего состояния
 * не меняет вовсе, и запись о нём была бы шумом в том месте, куда
 * приходят разбираться.
 */

/**
 * Закрепить разговор в своей панели либо снять закрепление.
 *
 * Видимость проверяется той же проверкой, что и везде: закрепить
 * невидимый разговор нельзя — иначе панель рассказала бы о нём.
 */
export async function setConversationPin(
  viewer: Viewer,
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  await withTransaction(async (tx) => {
    await requireVisible(tx, viewer, conversationId);

    if (!pinned) {
      await tx
        .delete(pin)
        .where(
          and(eq(pin.participantId, viewer.participantId), eq(pin.conversationId, conversationId)),
        );
      return;
    }

    // ⚠️ ПОВТОР — НЕ ОШИБКА. Нажать булавку на уже закреплённом значит
    // «пусть будет закреплено», и исход тот же. Уникальный индекс
    // делает это утверждение правдой на уровне базы, а не надежды.
    await tx
      .insert(pin)
      .values({
        participantId: viewer.participantId,
        workspaceId: viewer.workspaceId,
        conversationId,
      })
      .onConflictDoNothing();
  });
}

/** Закрепить проект в своей панели либо снять закрепление. */
export async function setProjectPin(
  viewer: Viewer,
  projectId: string,
  pinned: boolean,
): Promise<void> {
  await withTransaction(async (tx) => {
    await requireProject(tx, viewer.workspaceId, projectId);

    if (!pinned) {
      await tx
        .delete(pin)
        .where(and(eq(pin.participantId, viewer.participantId), eq(pin.projectId, projectId)));
      return;
    }

    await tx
      .insert(pin)
      .values({
        participantId: viewer.participantId,
        workspaceId: viewer.workspaceId,
        projectId,
      })
      .onConflictDoNothing();
  });
}
