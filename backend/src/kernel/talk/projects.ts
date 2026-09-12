import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { change } from "../../platform/change.js";
import { db, type Executor } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import * as repo from "./repo.js";
import { conversation, pin, project } from "./schema.js";

/**
 * Проекты: папка чатов и область чтения агента (Р-032). Своих прав нет:
 * видимость живёт у разговора (Р-010), иначе у доступа было бы два ответа.
 */

/**
 * Проекты для панели, одним запросом. Скрыт проект, где человеку не виден
 * ни один чат, — имя папки «Зарплаты» уже сведения. Пустой виден всем:
 * скрывать нечего, а заводящий должен увидеть свою папку.
 */
/**
 * Правило «проект виден человеку» — одно на панель и на дверь порций.
 * Двумя копиями оно однажды разошлось бы, и дверь выдала бы папку,
 * которой нет в панели.
 */
function shownTo(participantId: string): SQL {
  const hasChats = sql`EXISTS (
    SELECT 1 FROM ${conversation}
    WHERE ${conversation.projectId} = ${project.id}
      AND ${conversation.deletedAt} IS NULL
  )`;
  const hasVisible = sql`EXISTS (
    SELECT 1 FROM ${conversation}
    WHERE ${conversation.projectId} = ${project.id}
      AND ${repo.visibleTo(participantId)}
  )`;
  return sql`(NOT ${hasChats} OR ${hasVisible})`;
}

export async function listProjectsFor(tx: Executor, participantId: string, workspaceId: string) {
  const pinned = sql<boolean>`EXISTS (
    SELECT 1 FROM ${pin}
    WHERE ${pin.projectId} = ${project.id}
      AND ${pin.participantId} = ${participantId}
  )`;

  return (
    tx
      .select({
        id: project.id,
        title: project.title,
        icon: project.icon,
        color: project.color,
        pinned: pinned,
      })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, workspaceId),
          isNull(project.deletedAt),
          shownTo(participantId),
        ),
      )
      // Закреплённые сверху, остальные по алфавиту; порядок задаёт сервер.
      .orderBy(desc(pinned), asc(project.title))
  );
}

/**
 * Проект виден ровно тогда, когда он попал бы в панель этого человека.
 * Отдельная дверь порций не должна выдавать существование скрытой папки.
 */
export function requireVisibleProject(
  tx: Executor,
  participantId: string,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  return requireProject(tx, workspaceId, projectId, shownTo(participantId));
}

/** Завести проект — любому: прав он не несёт. */
export async function createProject(
  viewer: Viewer,
  input: { title: string; icon?: string | undefined; color?: string | undefined },
): Promise<{ id: string }> {
  return change(viewer.workspaceId, async (tx) => {
    const rows = await tx
      .insert(project)
      .values({
        workspaceId: viewer.workspaceId,
        title: input.title,
        icon: input.icon ?? null,
        color: input.color ?? null,
      })
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
 * Проект жив и из того же пространства — одна проверка для переноса,
 * заводки внутри, правки и булавки. Нет и чужой — одинаковое «не найдено».
 */
export async function requireProject(
  tx: Executor,
  workspaceId: string,
  projectId: string,
  /** Ещё условие к «жив и свой» — например, виден ли он человеку. */
  also?: SQL,
): Promise<void> {
  const found = await tx
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
        also,
      ),
    )
    .limit(1);
  if (!found[0]) throw new ConversationNotVisibleError();
}

/** Имя и вид папки — одной правкой: в окне это одно действие. */
export async function renameProject(
  viewer: Viewer,
  projectId: string,
  edit: {
    title?: string | undefined;
    icon?: string | null | undefined;
    color?: string | null | undefined;
  },
): Promise<{ id: string }> {
  return change(viewer.workspaceId, async (tx) => {
    await requireProject(tx, viewer.workspaceId, projectId);
    // Не переданное не трогаем: «не указано» ≠ «убрать» (`null`).
    const fields = {
      ...(edit.title === undefined ? {} : { title: edit.title }),
      ...(edit.icon === undefined ? {} : { icon: edit.icon }),
      ...(edit.color === undefined ? {} : { color: edit.color }),
    };
    if (Object.keys(fields).length > 0) {
      await tx.update(project).set(fields).where(eq(project.id, projectId));
    }

    await appendEvent(tx, {
      kind: "project.renamed",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "project",
      subjectId: projectId,
      payload: fields,
    });
    return { id: projectId };
  });
}

/**
 * Убрать проект: папка исчезает, чаты уходят в «вне проектов». Ссылка
 * снимается явно — удаление мягкое, и `ON DELETE SET NULL` не сработает.
 */
export async function removeProject(viewer: Viewer, projectId: string): Promise<void> {
  await change(viewer.workspaceId, async (tx) => {
    await requireProject(tx, viewer.workspaceId, projectId);

    await tx
      .update(conversation)
      .set({ projectId: null })
      .where(eq(conversation.projectId, projectId));
    await tx.update(project).set({ deletedAt: new Date() }).where(eq(project.id, projectId));

    await appendEvent(tx, {
      kind: "project.removed",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "project",
      subjectId: projectId,
      payload: {},
    });
  });
}

/**
 * Отнести чат к проекту или снять (`null`). Чат — на видимость позвавшему,
 * проект — на своё пространство.
 */
export async function setProject(
  viewer: Viewer,
  conversationId: string,
  projectId: string | null,
): Promise<{ id: string; projectId: string | null }> {
  return change(viewer.workspaceId, async (tx) => {
    await requireVisible(tx, viewer, conversationId);
    if (projectId !== null) await requireProject(tx, viewer.workspaceId, projectId);

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
 * Область чтения агента: лента чатов проекта, видимых позвавшему.
 * Видимость стоит в самом отборе — агент действует в правах позвавшего
 * (OWASP LLM06: Excessive Agency). Лента — здесь же, одним запросом (Д-31).
 * `null` — область равна одному разговору.
 */
export interface ScopeFeed {
  /** Названия прочитанных чатов — их агент называет в ответе. */
  titles: string[];
  /** Слитая лента области, старое первым. */
  lines: { body: string; authorName: string; authorKind: string; where: string }[];
}

export async function scopeFeed(
  viewer: Viewer,
  conversationId: string,
  limit: number,
): Promise<ScopeFeed | null> {
  const current = await requireVisible(db, viewer, conversationId);
  if (!current.projectId) return null;

  const chats = await db
    .select({ id: conversation.id, title: conversation.title })
    .from(conversation)
    .where(and(eq(conversation.projectId, current.projectId), repo.visibleTo(viewer.participantId)))
    .orderBy(asc(conversation.createdAt));

  // Один видимый чат — это не область, а тот же разговор.
  if (chats.length < 2) return null;

  const titleOf = new Map(chats.map((one) => [one.id, one.title]));
  const feed = await repo.listMessagesIn(
    db,
    chats.map((one) => one.id),
    limit,
  );

  return {
    titles: chats.map((one) => one.title),
    lines: feed.map((one) => ({
      body: one.body,
      authorName: one.authorName,
      authorKind: one.authorKind,
      where: titleOf.get(one.conversationId) ?? "",
    })),
  };
}
