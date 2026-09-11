import { and, eq } from "drizzle-orm";
import { withTransaction } from "../../platform/db.js";
import { requireVisible, type Viewer } from "./access.js";
import { requireProject } from "./projects.js";
import { pin } from "./schema.js";

/**
 * Закрепление в панели — личное (Д-32). Звонка нет: `publish` будит все
 * вкладки пространства, а булавка видна только мне. В журнал не пишем —
 * единственное отступление от Р-2 (task-038 §9): общее состояние не меняется.
 */

/** Закрепить разговор в своей панели или снять. Невидимый закрепить нельзя. */
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

    // Повтор — не ошибка: уникальный индекс держит это на уровне базы.
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
