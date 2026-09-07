import type { Executor } from "../../platform/db.js";
import { event } from "./schema.js";

export interface EventInput {
  kind: string;
  workspaceId?: string | null;
  actorParticipantId?: string | null;
  /** Чьей властью действовали — влияет на права. */
  originatorAccountId?: string | null;
  /** Кто отвечает за результат — влияет на аудит. Это разные люди (Р-3). */
  accountableAccountId?: string | null;
  attribution?: "direct_human" | "delegation" | "owner_fallback" | "unattributed";
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Единственный способ записать событие.
 *
 * Вызывается ТОЛЬКО изнутри службы, в той же транзакции, что и изменение
 * состояния. Отдельного «допишем лог потом» не существует — см. Р-2.
 */
export async function appendEvent(tx: Executor, input: EventInput): Promise<void> {
  await tx.insert(event).values({
    kind: input.kind,
    workspaceId: input.workspaceId ?? null,
    actorParticipantId: input.actorParticipantId ?? null,
    originatorAccountId: input.originatorAccountId ?? null,
    accountableAccountId: input.accountableAccountId ?? null,
    attribution: input.attribution ?? "direct_human",
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    payload: input.payload ?? {},
  });
}
