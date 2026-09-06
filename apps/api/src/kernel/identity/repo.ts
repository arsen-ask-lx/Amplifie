import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Executor } from "../../platform/db.js";
import { workspace } from "../space/schema.js";
import { account, participant, session } from "./schema.js";

/**
 * Слой хранилища модуля identity. Только запросы, никакой логики.
 * Никто снаружи модуля сюда не ходит — это стережёт гейт границ.
 */

export async function findAccountByEmail(tx: Executor, email: string) {
  const rows = await tx.select().from(account).where(eq(account.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function insertAccount(tx: Executor, email: string, passwordHash: string) {
  const rows = await tx.insert(account).values({ email, passwordHash }).returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать аккаунт");
  return row;
}

export async function insertWorkspace(tx: Executor, name: string) {
  const rows = await tx.insert(workspace).values({ name }).returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать пространство");
  return row;
}

export async function insertParticipant(
  tx: Executor,
  input: { workspaceId: string; accountId: string; displayName: string; role: string },
) {
  const rows = await tx
    .insert(participant)
    .values({ ...input, kind: "human" })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать участника");
  return row;
}

export async function insertSession(
  tx: Executor,
  input: { accountId: string; tokenHash: string; expiresAt: Date },
) {
  const rows = await tx.insert(session).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать сессию");
  return row;
}

export async function deleteSessionByTokenHash(tx: Executor, tokenHash: string) {
  await tx.delete(session).where(eq(session.tokenHash, tokenHash));
}

/** Живая сессия + кто это + где. Один запрос, чтобы не плодить N+1 на каждом вызове. */
export async function findLiveSession(tx: Executor, tokenHash: string, now: Date) {
  const rows = await tx
    .select({
      sessionId: session.id,
      accountId: account.id,
      email: account.email,
      participantId: participant.id,
      displayName: participant.displayName,
      kind: participant.kind,
      role: participant.role,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })
    .from(session)
    .innerJoin(account, eq(account.id, session.accountId))
    .innerJoin(participant, eq(participant.accountId, account.id))
    .innerJoin(workspace, eq(workspace.id, participant.workspaceId))
    .where(and(eq(session.tokenHash, tokenHash), gt(session.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Отметка «сессия жива».
 *
 * ⚠️ Пишется НЕ на каждый запрос. Наивная версия делала UPDATE при каждом
 * обращении: на чате с догоном это запись на каждое чтение — раздувание
 * таблицы, работа автоочистке и лишняя нагрузка ради поля, точность
 * которого никому не нужна до минуты.
 *
 * Условие в самом запросе: строка обновляется, только если отметка старее
 * порога. Гонки не боимся — идемпотентно по построению.
 */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function touchSession(tx: Executor, sessionId: string, now: Date) {
  const staleBefore = new Date(now.getTime() - TOUCH_EVERY_MS);
  await tx
    .update(session)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(session.id, sessionId),
        or(isNull(session.lastSeenAt), lt(session.lastSeenAt, staleBefore)),
      ),
    );
}
