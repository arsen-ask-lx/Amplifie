import { createHash } from "node:crypto";
import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";

/**
 * Ядро продукта: договорённость → подтверждение → задача.
 *
 * Здесь нет ни модели, ни правил распознавания: их место в `agent/`,
 * который выбрасывается целиком. Сюда приходит уже услышанное.
 */

/** Нет такой договорённости ЛИБО она не твоя — снаружи это одно и то же. */
export class AgreementNotVisibleError extends Error {}

export interface Actor {
  workspaceId: string;
  participantId: string;
  kind: string;
}

export interface Proposal {
  messageId: string;
  quote: string;
  text: string;
}

export interface AgreementView {
  id: string;
  conversationId: string;
  text: string;
  status: string;
  confirmedBy: string | null;
  createdAt: Date;
  citations: Array<{ messageId: string; quote: string }>;
}

/**
 * Отпечаток источника: по нему повторный разбор узнаёт ту же самую
 * договорённость. Берём идентификаторы сообщений, а не текст: текст могут
 * отредактировать, и тогда «то же самое» превратилось бы в «новое».
 */
function fingerprint(messageIds: string[]): string {
  return createHash("sha256")
    .update([...messageIds].sort().join("|"))
    .digest("hex");
}

/**
 * Записать услышанное как ПРЕДЛОЖЕННЫЕ договорённости.
 *
 * Ничего не подтверждает: гейт одобрения — человек, и обойти его отсюда
 * нельзя даже случайно, потому что статус здесь не параметр.
 */
export async function propose(
  by: { workspaceId: string; participantId: string },
  conversationId: string,
  heard: Proposal[],
): Promise<number> {
  if (heard.length === 0) return 0;

  return withTransaction(async (tx) => {
    let added = 0;
    for (const item of heard) {
      const created = await repo.insertAgreement(tx, {
        workspaceId: by.workspaceId,
        conversationId,
        proposedBy: by.participantId,
        text: item.text,
        sourceFingerprint: fingerprint([item.messageId]),
      });
      // Уже была — повторный разбор ничего не меняет и ничего не пишет.
      if (!created) continue;

      await repo.insertCitation(tx, {
        workspaceId: by.workspaceId,
        agreementId: created.id,
        messageId: item.messageId,
        quote: item.quote,
      });

      await appendEvent(tx, {
        kind: "agreement.proposed",
        workspaceId: by.workspaceId,
        actorParticipantId: by.participantId,
        subjectType: "agreement",
        subjectId: created.id,
        payload: { conversationId, citedMessageId: item.messageId },
      });
      added++;
    }
    return added;
  });
}

/**
 * Подтвердить или отклонить. **Только человек.**
 *
 * Гейт одобрения — не украшение: измерено, что человек принимает 10–20%
 * НЕВЕРНЫХ предложений (Р-004). Гейт не спасает от ошибки агента, но
 * без него не спасает вообще ничто.
 */
export async function decide(
  actor: Actor,
  agreementId: string,
  verdict: "confirm" | "reject",
): Promise<AgreementView> {
  if (actor.kind !== "human") {
    throw new AgreementNotVisibleError();
  }

  const changed = await withTransaction(async (tx) => {
    const updated = await repo.setAgreementStatus(tx, {
      id: agreementId,
      workspaceId: actor.workspaceId,
      status: verdict === "confirm" ? "confirmed" : "rejected",
      confirmedBy: verdict === "confirm" ? actor.participantId : null,
      now: new Date(),
    });
    if (!updated) throw new AgreementNotVisibleError();

    // Задача рождается ТОЛЬКО из подтверждённой. Повторное подтверждение
    // второй не заводит — за это отвечает уникальность в базе, а не
    // проверка «а нет ли уже», которая была бы гонкой.
    if (verdict === "confirm") {
      await repo.insertTask(tx, {
        workspaceId: actor.workspaceId,
        agreementId: updated.id,
        title: updated.text,
      });
    }

    await appendEvent(tx, {
      kind: verdict === "confirm" ? "agreement.confirmed" : "agreement.rejected",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      subjectType: "agreement",
      subjectId: updated.id,
      payload: {},
    });

    return updated;
  });

  return viewOf(db, changed.id, actor.workspaceId);
}

async function withCitations(
  tx: Executor,
  rows: Awaited<ReturnType<typeof repo.listAgreementsIn>>,
): Promise<AgreementView[]> {
  const cites = await repo.citationsFor(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    text: row.text,
    status: row.status,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
    citations: cites
      .filter((c) => c.agreementId === row.id)
      .map((c) => ({ messageId: c.messageId, quote: c.quote })),
  }));
}

async function viewOf(tx: Executor, id: string, workspaceId: string): Promise<AgreementView> {
  const all = await withCitations(tx, await repo.listAgreementsIn(tx, workspaceId));
  const found = all.find((a) => a.id === id);
  if (!found) throw new AgreementNotVisibleError();
  return found;
}

export async function listAgreements(workspaceId: string): Promise<AgreementView[]> {
  return withCitations(db, await repo.listAgreementsIn(db, workspaceId));
}

/**
 * Задачи вместе с цитатами договорённости, из которой родились.
 *
 * К5 «задача несёт контекст» — это не метафора: по задаче обязан
 * открываться путь до реплики, из которой она взялась.
 */
export async function listTasks(workspaceId: string) {
  const rows = await repo.listTasksIn(db, workspaceId);
  const cites = await repo.citationsFor(
    db,
    rows.map((r) => r.agreementId),
  );

  return rows.map((row) => ({
    id: row.id,
    agreementId: row.agreementId,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    citations: cites
      .filter((c) => c.agreementId === row.agreementId)
      .map((c) => ({ messageId: c.messageId, quote: c.quote })),
  }));
}
