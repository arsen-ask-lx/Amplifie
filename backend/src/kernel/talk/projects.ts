import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { change } from "../../platform/change.js";
import { db, type Executor } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import * as repo from "./repo.js";
import { conversation, pin, project } from "./schema.js";

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
          sql`(NOT ${hasChats} OR ${hasVisible})`,
        ),
      )
      // Закреплённые сверху, остальные по алфавиту — порядок задаёт сервер,
      // как и у разговоров (task-038).
      .orderBy(desc(pinned), asc(project.title))
  );
}

/**
 * Завести проект. Прав он не несёт, поэтому и заводить его может любой.
 *
 * ⚠️ ЗВОНОК ПОСЛЕ ФИКСАЦИИ — КАК У КАНАЛА. Панель у всех, кто видит
 * пространство, обязана обновиться без перезагрузки страницы. Без звонка
 * заведённый проект появлялся бы у соседа только назавтра; поймано
 * сценарием «переименование доезжает до второй вкладки».
 */
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
/**
 * Проект существует, жив и принадлежит ТОМУ ЖЕ пространству.
 *
 * ⚠️ ОДНО МЕСТО НА ВСЕ ТРИ СЛУЧАЯ: перенести чат, завести чат сразу
 * внутри, переименовать. Разъехавшись копиями, они однажды ответили бы
 * по-разному на вопрос «чей это проект» — и по номеру из соседней
 * компании можно было бы утащить свой чат к ним в панель.
 *
 * Нет и не виден — снаружи одно и то же, 404: иначе по ответу
 * перебираются существующие проекты.
 */
export async function requireProject(
  tx: Executor,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const found = await tx
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        eq(project.workspaceId, workspaceId),
        isNull(project.deletedAt),
      ),
    )
    .limit(1);
  if (!found[0]) throw new ConversationNotVisibleError();
}

/**
 * Переименовать проект и/или сменить его вид (task-038).
 *
 * ⚠️ ОДНА ДВЕРЬ НА ИМЯ И ВИД, А НЕ ДВЕ. Снаружи это одно действие —
 * «поправить папку», и человек в окне меняет и то и другое разом.
 * Двумя дверями окно делало бы два запроса, и один из них однажды
 * прошёл бы, а второй нет.
 */
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
    // Не переданное не трогаем: «не указано» и «убрать» — разные вещи,
    // и первое не должно молча стирать второе.
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
 * Убрать проект.
 *
 * ⚠️ ПАПКА ИСЧЕЗАЕТ, ПЕРЕПИСКА ОСТАЁТСЯ, И ЭТО ЕДИНСТВЕННАЯ ТРАКТОВКА
 * СЛОВА «УБРАТЬ», КОТОРАЯ НЕ ТЕРЯЕТ ЧУЖИЕ СЛОВА. Чаты возвращаются
 * к чатам вне проектов.
 *
 * ⚠️ ПРИНАДЛЕЖНОСТЬ СНИМАЕТСЯ ЯВНО, А НЕ ОСТАЁТСЯ НА МЁРТВОМ ПРОЕКТЕ.
 * Удаление у нас мягкое, поэтому `ON DELETE SET NULL` не сработает —
 * строка проекта остаётся жить. Не сними мы ссылку, чат оказался бы
 * нигде: в списке проектов его папки уже нет, а к чатам вне проектов
 * он не относится. В панели он просто пропал бы.
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
 * Область чтения агента: лента чатов проекта, ВИДИМЫХ позвавшему.
 *
 * ⚠️ ПЕРЕСЕЧЕНИЕ СЧИТАЕТСЯ ОДНИМ ЗАПРОСОМ, А НЕ ПРОВЕРКОЙ ПОСЛЕ ОТБОРА.
 * «Взять чаты проекта, потом отсеять невидимые» — то же самое ровно
 * до того дня, когда отсев забудут поставить в новой ветке кода.
 * Здесь забыть нечего: условие видимости стоит в самом отборе.
 *
 * Это и есть защита от того, что OWASP зовёт `LLM06: Excessive Agency`:
 * агент действует в правах позвавшего, а не в правах системы.
 *
 * ⚠️ ЛЕНТА ЧИТАЕТСЯ ЗДЕСЬ ЖЕ И ОДНИМ ЗАПРОСОМ (Д-31). Раньше область
 * возвращала список номеров, а звавший читал каждый чат отдельно —
 * три запроса на чат, шестьдесят на проект из двадцати. Отдавать
 * «список чатов» наружу и значило приглашать читать их по одному:
 * граница знания проходит не по номерам, а по ГОТОВОЙ ленте области.
 *
 * `null` — область равна одному разговору: он вне проектов либо
 * в проекте, где виден только он сам. Тогда звавший читает его тем же
 * путём, что и до Р-032, и лишнего запроса не делает вовсе.
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
