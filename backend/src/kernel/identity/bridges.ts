import { db, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";
import { hashToken, newToken } from "./tokens.js";

/**
 * Мосты: своя подписка у каждого участника (task-001, Р-012).
 *
 * Отдельным файлом от остального удостоверения не по объёму, а по смыслу:
 * сессия отвечает на вопрос «кто этот человек», мост — «на какой машине
 * живёт его подписка». Токена подписки здесь нет: его читает официальный
 * клиент, сам, у себя.
 */

/** Код живёт недолго: его копируют со страницы и вставляют сразу. */
const BRIDGE_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Мост считается «на связи», если приходил за работой не давнее этого.
 * Больше, чем срок одного ожидания (25 с), иначе состояние мигало бы
 * в промежутке между двумя заходами.
 */
const ONLINE_WINDOW_MS = 70 * 1000;

export interface BridgeView {
  id: string;
  name: string | null;
  joined: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/**
 * Выдать код подключения. Показывается ОДИН раз — в базе только хеш.
 *
 * Потерял — выпусти новый: это дешевле, чем хранить значение, которым
 * можно подключить машину от чужого имени (Р-009).
 */
export async function issueBridgeCode(by: {
  workspaceId: string;
  participantId: string;
  accountId: string;
}): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = newToken();
  const expiresAt = new Date(Date.now() + BRIDGE_CODE_TTL_MS);

  return withTransaction(async (tx) => {
    const created = await repo.insertBridge(tx, {
      workspaceId: by.workspaceId,
      participantId: by.participantId,
      codeHash: hashToken(code),
      codeExpiresAt: expiresAt,
    });

    await appendEvent(tx, {
      kind: "bridge.code.issued",
      workspaceId: by.workspaceId,
      actorParticipantId: by.participantId,
      originatorAccountId: by.accountId,
      accountableAccountId: by.accountId,
      subjectType: "bridge",
      subjectId: created.id,
      // Ни кода, ни его хеша: журнал вечен и его читают.
      payload: { expiresAt: expiresAt.toISOString() },
    });

    return { id: created.id, code, expiresAt };
  });
}

/** Мост подключается: код меняется на постоянный токен. Ровно один раз. */
export async function joinBridge(
  code: string,
  name: string,
): Promise<{ id: string; token: string; workspaceId: string } | null> {
  const machine = name.trim();
  if (!machine) return null;

  const token = newToken();
  const now = new Date();

  return withTransaction(async (tx) => {
    const claimed = await repo.claimBridge(tx, {
      codeHash: hashToken(code),
      tokenHash: hashToken(token),
      name: machine,
      now,
    });
    // Нет такого кода, погашен, отозван или просрочен — снаружи одно и то же.
    if (!claimed) return null;

    await appendEvent(tx, {
      kind: "bridge.joined",
      workspaceId: claimed.workspaceId,
      actorParticipantId: claimed.participantId,
      subjectType: "bridge",
      subjectId: claimed.id,
      payload: {},
    });

    return { id: claimed.id, token, workspaceId: claimed.workspaceId };
  });
}

/** Кто пришёл за работой. Отдельно от сессии: это удостоверение машины. */
export async function resolveBridge(
  token: string | undefined,
): Promise<{ id: string; workspaceId: string; participantId: string } | null> {
  if (!token) return null;
  const found = await repo.findBridgeByToken(db, hashToken(token));
  if (!found) return null;
  return { id: found.id, workspaceId: found.workspaceId, participantId: found.participantId };
}

/** Отметить заход моста за работой — по этому и считается «на связи». */
export async function markBridgeSeen(bridgeId: string): Promise<void> {
  await repo.touchBridge(db, bridgeId, new Date());
}

export async function listBridges(participantId: string): Promise<BridgeView[]> {
  const rows = await repo.listBridgesOf(db, participantId);
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    joined: row.joinedAt !== null,
    // Выданный, но не погашенный код мостом не считается: человек
    // иначе видит «мост есть», а спросить не может.
    online:
      row.joinedAt !== null &&
      row.lastSeenAt !== null &&
      now - row.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  }));
}
