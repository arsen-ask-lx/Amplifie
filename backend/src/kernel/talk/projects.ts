import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import * as repo from "./repo.js";
import { conversation, project } from "./schema.js";

/**
 * Проекты: папка чатов и область чтения агента (Р-032).
 *
 * ⚠️ ПРОЕКТ НЕ ОТВЕЧАЕТ НА ВОПРОС «КОМУ МОЖНО». Ни одной проверки прав
 * здесь нет и быть не должно: видимость живёт у разговора (Р-010),
 * и всё, что ниже, опирается на неё же — `visibleTo` и `requireVisible`.
 * Заведи мы тут вторую проверку, у человека появилось бы два способа
 * получить доступ, и на вопрос «почему он это видит» пришлось бы
 * отвечать дважды.
 */

/**
 * Проекты, которые человеку есть смысл показывать.
 *
 * ⚠️ ОДНИМ ЗАПРОСОМ, А НЕ «СПИСОК ПРОЕКТОВ, ПОТОМ ЧАТЫ КАЖДОГО».
 * Панель — самый частый экран продукта, и второй способ был бы N+1,
 * незаметным ровно до тех пор, пока проектов три.
 *
 * ⚠️ ПРОЕКТ, ГДЕ ЧЕЛОВЕКУ НЕ ВИДЕН НИ ОДИН ЧАТ, НЕ ПОКАЗЫВАЕТСЯ.
 * Иначе название папки рассказывало бы о существовании закрытой темы:
 * «Зарплаты» в списке — уже сведения. ПУСТОЙ проект при этом виден
 * всем: в нём нечего скрывать, а спрятать только что заведённую папку
 * от того, кто её завёл, значило бы сломать саму заводку.
 */
export async function listProjectsFor(tx: Executor, participantId: string, workspaceId: string) {
  const естьЧаты = sql`EXISTS (
    SELECT 1 FROM ${conversation}
    WHERE ${conversation.projectId} = ${project.id}
      AND ${conversation.deletedAt} IS NULL
  )`;
  const естьВидимый = sql`EXISTS (
    SELECT 1 FROM ${conversation}
    WHERE ${conversation.projectId} = ${project.id}
      AND ${repo.visibleTo(participantId)}
  )`;

  return tx
    .select({ id: project.id, title: project.title })
    .from(project)
    .where(
      and(
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
        sql`(NOT ${естьЧаты} OR ${естьВидимый})`,
      ),
    )
    .orderBy(asc(project.title));
}

/** Завести проект. Прав он не несёт, поэтому и заводить его может любой. */
export async function createProject(viewer: Viewer, title: string): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const rows = await tx
      .insert(project)
      .values({ workspaceId: viewer.workspaceId, title })
      .returning({ id: project.id, title: project.title });
    const created = rows[0];
    if (!created) throw new Error("проект не завёлся");

    await appendEvent(tx, {
      kind: "project.created",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "project",
      subjectId: created.id,
      payload: { title: created.title },
    });
    return created;
  });
}

/**
 * Отнести чат к проекту либо снять принадлежность (`null`).
 *
 * ⚠️ ОБЕ СТОРОНЫ ПРОВЕРЯЮТСЯ, И ПО-РАЗНОМУ. Чат — на видимость
 * позвавшему (`requireVisible`): относить к папке чужую переписку
 * нельзя. Проект — на принадлежность ТОМУ ЖЕ пространству: иначе
 * по номеру проекта из соседней компании можно было бы утащить
 * свой чат к ним в панель.
 *
 * Не найдено и не видно — снаружи одно и то же, 404: иначе по ответу
 * перебираются существующие проекты.
 */
export async function setProject(
  viewer: Viewer,
  conversationId: string,
  projectId: string | null,
): Promise<{ id: string; projectId: string | null }> {
  return withTransaction(async (tx) => {
    await requireVisible(tx, viewer, conversationId);

    if (projectId !== null) {
      const найден = await tx
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.id, projectId),
            eq(project.workspaceId, viewer.workspaceId),
            isNull(project.deletedAt),
          ),
        )
        .limit(1);
      if (!найден[0]) throw new ConversationNotVisibleError();
    }

    await tx
      .update(conversation)
      .set({ projectId })
      .where(
        and(eq(conversation.id, conversationId), eq(conversation.workspaceId, viewer.workspaceId)),
      );

    await appendEvent(tx, {
      kind: "conversation.moved",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "conversation",
      subjectId: conversationId,
      payload: { projectId },
    });

    return { id: conversationId, projectId };
  });
}

/**
 * Область чтения агента: чаты проекта, ВИДИМЫЕ позвавшему.
 *
 * ⚠️ ПЕРЕСЕЧЕНИЕ СЧИТАЕТСЯ ОДНИМ ЗАПРОСОМ, А НЕ ПРОВЕРКОЙ ПОСЛЕ ОТБОРА.
 * «Взять чаты проекта, потом отсеять невидимые» — то же самое ровно
 * до того дня, когда отсев забудут поставить в новой ветке кода.
 * Здесь забыть нечего: условие видимости стоит в самом отборе.
 *
 * Это и есть защита от того, что OWASP зовёт `LLM06: Excessive Agency`:
 * агент действует в правах позвавшего, а не в правах системы. Разговор,
 * не принадлежащий никакому проекту, даёт область из самого себя —
 * поведение до Р-032 сохраняется в точности.
 */
export async function readingScope(
  viewer: Viewer,
  conversationId: string,
): Promise<{ ids: string[]; titles: string[] }> {
  const текущий = await requireVisible(db, viewer, conversationId);
  if (!текущий.projectId) return { ids: [conversationId], titles: [текущий.title] };

  const rows = await db
    .select({ id: conversation.id, title: conversation.title })
    .from(conversation)
    .where(and(eq(conversation.projectId, текущий.projectId), repo.visibleTo(viewer.participantId)))
    .orderBy(asc(conversation.createdAt));

  return { ids: rows.map((one) => one.id), titles: rows.map((one) => one.title) };
}
