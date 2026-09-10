import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { publish } from "../../platform/bus.js";
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

/**
 * Завести проект. Прав он не несёт, поэтому и заводить его может любой.
 *
 * ⚠️ ЗВОНОК ПОСЛЕ ФИКСАЦИИ — КАК У КАНАЛА. Панель у всех, кто видит
 * пространство, обязана обновиться без перезагрузки страницы. Без звонка
 * заведённый проект появлялся бы у соседа только назавтра; поймано
 * сценарием «переименование доезжает до второй вкладки».
 */
export async function createProject(viewer: Viewer, title: string): Promise<{ id: string }> {
  const created = await withTransaction(async (tx) => {
    const created = await repo.insertProject(tx, { workspaceId: viewer.workspaceId, title });

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

  publish(viewer.workspaceId);
  return created;
}

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
export async function требуетсяПроект(
  tx: Executor,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const найден = await tx
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
  if (!найден[0]) throw new ConversationNotVisibleError();
}

/** Переименовать проект. */
export async function renameProject(
  viewer: Viewer,
  projectId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const переименован = await withTransaction(async (tx) => {
    await требуетсяПроект(tx, viewer.workspaceId, projectId);
    await tx.update(project).set({ title }).where(eq(project.id, projectId));

    await appendEvent(tx, {
      kind: "project.renamed",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "project",
      subjectId: projectId,
      payload: { title },
    });
    return { id: projectId, title };
  });

  publish(viewer.workspaceId);
  return переименован;
}

/**
 * Убрать проект вместе с чатами внутри.
 *
 * ⚠️ ПРЕЖДЕ БЫЛО НАОБОРОТ: папка исчезала, чаты возвращались к чатам вне
 * проектов. Пока дома было два, это была самая мягкая трактовка слова
 * «убрать». Дом остался один (task-037), и та же мягкость превратилась
 * в потерю: чат без проекта не показать ни на одном экране. Владелец
 * 10.09 выбрал явное — уносим вместе, число чатов называем в вопросе.
 *
 * ⚠️ УДАЛЕНИЕ МЯГКОЕ И У ПАПКИ, И У ЧАТОВ. На реплики этих чатов
 * ссылаются ответы и пересылки из других проектов; каскад превратил бы
 * их в цитаты в пустоту. И вернуть мягко удалённое можно одним `UPDATE`,
 * а стёртое — ничем.
 */
export async function removeProject(viewer: Viewer, projectId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await требуетсяПроект(tx, viewer.workspaceId, projectId);

    const унесённые = new Date();
    const чаты = await tx
      .update(conversation)
      .set({ deletedAt: унесённые })
      .where(
        and(
          eq(conversation.projectId, projectId),
          eq(conversation.workspaceId, viewer.workspaceId),
          isNull(conversation.deletedAt),
        ),
      )
      .returning({ id: conversation.id });
    await tx.update(project).set({ deletedAt: унесённые }).where(eq(project.id, projectId));

    // ⚠️ В ЖУРНАЛ УХОДИТ ЧИСЛО УНЕСЁННЫХ ЧАТОВ. Это единственное место,
    // где одно нажатие убирает несколько разговоров: не запиши мы число,
    // на вопрос «куда делась переписка» пришлось бы отвечать догадками.
    await appendEvent(tx, {
      kind: "project.removed",
      workspaceId: viewer.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "project",
      subjectId: projectId,
      payload: { conversations: чаты.length },
    });
  });

  publish(viewer.workspaceId);
}

/**
 * Перенести чат в другой проект.
 *
 * ⚠️ ТОЛЬКО ИЗ ПАПКИ В ПАПКУ: «снять принадлежность» больше нет
 * (task-037). Прежде здесь принимался `null` — чат выходил к каналам
 * вне проектов. Раздела «Каналы» не стало, и тот же `null` означал бы
 * «спрятать переписку от всех, не удаляя её».
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
  projectId: string,
): Promise<{ id: string; projectId: string }> {
  const переложен = await withTransaction(async (tx) => {
    await requireVisible(tx, viewer, conversationId);
    await требуетсяПроект(tx, viewer.workspaceId, projectId);

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

  publish(viewer.workspaceId);
  return переложен;
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
  const текущий = await requireVisible(db, viewer, conversationId);
  if (!текущий.projectId) return null;

  const чаты = await db
    .select({ id: conversation.id, title: conversation.title })
    .from(conversation)
    .where(and(eq(conversation.projectId, текущий.projectId), repo.visibleTo(viewer.participantId)))
    .orderBy(asc(conversation.createdAt));

  // Один видимый чат — это не область, а тот же разговор.
  if (чаты.length < 2) return null;

  const имя = new Map(чаты.map((one) => [one.id, one.title]));
  const лента = await repo.listMessagesIn(
    db,
    чаты.map((one) => one.id),
    limit,
  );

  return {
    titles: чаты.map((one) => one.title),
    lines: лента.map((one) => ({
      body: one.body,
      authorName: one.authorName,
      authorKind: one.authorKind,
      where: имя.get(one.conversationId) ?? "",
    })),
  };
}
