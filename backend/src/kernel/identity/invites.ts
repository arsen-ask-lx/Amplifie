import { withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";
import {
  type Actor,
  asActor,
  EmailTakenError,
  hashPassword,
  newSession,
  normalizeEmail,
} from "./service.js";
import { hashToken, newToken } from "./tokens.js";

/**
 * Приглашения: как второй человек попадает в компанию (Р-009, task-017).
 *
 * ⚠️ ЭТО ЕДИНСТВЕННАЯ ДВЕРЬ ВНУТРЬ, И ВТОРОЙ БЫТЬ НЕ ДОЛЖНО. Класс
 * уязвимости, ради которого написано Р-009: тот же токен, поданный через
 * ДРУГОЙ поток входа, обходил проверку доступа. Ошибка была не в токене —
 * в том, что путей оказалось два, и второй забыли проверить. Поэтому
 * участник по приглашению рождается ровно здесь; регистрация про токен
 * не знает вовсе и знать не должна.
 *
 * Отдельным файлом от `service.ts` по смыслу, а не по объёму: там
 * «кто этот человек», здесь — «как он сюда попал».
 */

/** Тридцать дней, как у Slack: ссылку передают руками, а не письмом. */
const INVITE_TTL_DAYS = 30;

/**
 * Сколько человек может войти по одной ссылке, если не сказано иное.
 *
 * ⚠️ ПРЕДЕЛА «БЕЗ ОГРАНИЧЕНИЯ» НЕТ НАМЕРЕННО. Утёкшая бессрочная ссылка —
 * неограниченный ущерб; утёкшая с пределом — ограниченный. Верхнюю
 * границу в 500 держит CHECK в базе, а не только это число.
 */
const DEFAULT_MAX_USES = 50;

export interface InviteView {
  id: string;
  /** Сам токен. Отдаётся ОДИН раз, при создании: в базе только хеш. */
  token: string;
  expiresAt: Date;
  maxUses: number;
  used: number;
}

export class InviteNotUsableError extends Error {}

/**
 * Позвать в компанию: выдать ссылку.
 *
 * Токен показывается один раз. Потерял — выпусти новый; это дешевле,
 * чем хранить у себя то, чем можно войти.
 */
export async function createInvite(
  by: { workspaceId: string; participantId: string; accountId: string },
  options: { maxUses?: number | undefined } = {},
): Promise<InviteView> {
  const token = newToken();
  const maxUses = options.maxUses ?? DEFAULT_MAX_USES;
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  return withTransaction(async (tx) => {
    const created = await repo.insertInvite(tx, {
      workspaceId: by.workspaceId,
      createdBy: by.participantId,
      tokenHash: hashToken(token),
      expiresAt,
      maxUses,
    });

    // Изменение состояния и событие — в одной транзакции. Всегда (Р-2).
    // ⚠️ НИ ТОКЕНА, НИ ЕГО ХЕША В ЖУРНАЛЕ: журнал читают больше людей,
    // чем базу.
    await appendEvent(tx, {
      kind: "invite.created",
      workspaceId: by.workspaceId,
      actorParticipantId: by.participantId,
      originatorAccountId: by.accountId,
      accountableAccountId: by.accountId,
      subjectType: "invite",
      subjectId: created.id,
      payload: { maxUses, expiresAt: expiresAt.toISOString() },
    });

    return { id: created.id, token, expiresAt, maxUses, used: created.used };
  });
}

/**
 * Отозвать приглашение.
 *
 * Чужое не находится — ровно как несуществующее. Разница в ответе была бы
 * способом узнать, какие приглашения живут в соседней компании.
 */
export async function revokeInvite(
  by: { workspaceId: string; participantId: string; accountId: string },
  inviteId: string,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const revoked = await repo.revokeInvite(tx, by.workspaceId, inviteId, new Date());
    if (!revoked) return false;

    await appendEvent(tx, {
      kind: "invite.revoked",
      workspaceId: by.workspaceId,
      actorParticipantId: by.participantId,
      originatorAccountId: by.accountId,
      accountableAccountId: by.accountId,
      subjectType: "invite",
      subjectId: revoked.id,
      payload: {},
    });
    return true;
  });
}

export interface JoinInput {
  token: string;
  email: string;
  password: string;
  displayName: string;
}

/**
 * Войти по приглашению: завести аккаунт и стать участником ЧУЖОЙ компании.
 *
 * ⚠️ ПОГАШЕНИЕ ИДЁТ ПЕРВЫМ И В ТОЙ ЖЕ ТРАНЗАКЦИИ. Оно же и есть проверка
 * права: условие живёт в самом `UPDATE`, и два устройства с последним
 * оставшимся входом получают один ответ на двоих. Проверить «а можно ли»
 * отдельным запросом было бы гонкой — той же, что мы уже ловили дважды.
 *
 * ⚠️ ЧЕТЫРЕ ПРИЧИНЫ ОТКАЗА НЕРАЗЛИЧИМЫ СНАРУЖИ: просрочено, отозвано,
 * исчерпано, нет такого. Наружу один и тот же отказ, иначе по разнице
 * ответов переберут живые приглашения.
 */
export async function joinByInvite(input: JoinInput): Promise<{ actor: Actor; token: string }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const { token, tokenHash, expiresAt } = newSession();

  return withTransaction(async (tx) => {
    const redeemed = await repo.redeemInvite(tx, hashToken(input.token), new Date());
    if (!redeemed) throw new InviteNotUsableError();

    if (await repo.findAccountByEmail(tx, email)) throw new EmailTakenError();

    const createdAccount = await repo.insertAccount(tx, email, passwordHash);
    const createdParticipant = await repo.insertParticipant(tx, {
      workspaceId: redeemed.workspaceId,
      accountId: createdAccount.id,
      displayName: input.displayName.trim(),
      role: redeemed.role,
    });
    const createdSession = await repo.insertSession(tx, {
      accountId: createdAccount.id,
      tokenHash,
      expiresAt,
    });
    const space = await repo.findWorkspace(tx, redeemed.workspaceId);
    if (!space) throw new InviteNotUsableError();

    await appendEvent(tx, {
      kind: "participant.joined",
      workspaceId: redeemed.workspaceId,
      actorParticipantId: createdParticipant.id,
      originatorAccountId: createdAccount.id,
      accountableAccountId: createdAccount.id,
      subjectType: "participant",
      subjectId: createdParticipant.id,
      payload: { role: redeemed.role, kind: "human", inviteId: redeemed.id },
    });

    return {
      token,
      actor: asActor({
        session: createdSession,
        account: createdAccount,
        participant: createdParticipant,
        workspace: space,
      }),
    };
  });
}
