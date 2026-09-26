import { db } from "../../platform/db.js";
import type { Viewer } from "./access.js";
import * as repo from "./repo.js";
import { presentConversation } from "./service.js";

/**
 * Поиск чата по названию — для окна «Переслать» (task-117, закрывает Д-41).
 *
 * ⚠️ ТОЛЬКО КОРНЕВЫЕ ЧАТЫ, КОТОРЫЕ ЧЕЛОВЕК ВИДИТ. Видимость та же, что
 * у панели (`listConversationsFor`): приватный чат соседа в выдаче — чужое
 * название, показанное постороннему.
 *
 * Регистр и ё не различаются — так человек и ищет «елку». Знаки `%`, `_`
 * и `\` в запросе — знаки, а не шаблон: «50%» не должно находить «500».
 */
export async function searchChats(viewer: Viewer, q: string, limit: number) {
  const needle = q
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[\\%_]/gu, "\\$&");
  const rows = await repo.listConversationsFor(db, viewer.participantId, viewer.workspaceId, {
    rootOnly: true,
    limit,
    titleLike: { anywhere: `%${needle}%`, start: `${needle}%` },
  });
  return { items: rows.map(presentConversation) };
}
