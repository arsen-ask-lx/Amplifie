import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Executor } from "../../platform/db.js";
import { workspace } from "../space/schema.js";
import { account, bridge, invite, modelKey, participant, session } from "./schema.js";

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

/**
 * Участник пространства: человек ИЛИ агент, одна сущность (Р-1).
 *
 * У агента аккаунта нет — он не входит по паролю. База это и стережёт:
 * `participant_account_matches_kind_ck` не даст завести человека
 * без аккаунта и агента с аккаунтом.
 */
/**
 * Есть ли на установке хоть одна компания (Р-024).
 *
 * ⚠️ СПРАШИВАЕМ «ХОТЬ ОДНА», А НЕ «СКОЛЬКО». Считать все строки, чтобы
 * узнать, есть ли хоть одна, — это работа, которая растёт вместе с базой
 * ради ответа «да».
 */
export async function anyWorkspaceExists(tx: Executor): Promise<boolean> {
  const rows = await tx.select({ id: workspace.id }).from(workspace).limit(1);
  return rows.length > 0;
}

/** Пространство по его идентификатору — нужно, чтобы назвать его вошедшему. */
export async function findWorkspace(tx: Executor, id: string) {
  const rows = await tx.select().from(workspace).where(eq(workspace.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertParticipant(
  tx: Executor,
  input: {
    workspaceId: string;
    accountId: string | null;
    displayName: string;
    role: string;
    kind?: string;
  },
) {
  const rows = await tx
    .insert(participant)
    .values({ ...input, kind: input.kind ?? "human" })
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

/**
 * Живая сессия + кто это + где. Один запрос, чтобы не плодить N+1 на каждом вызове.
 *
 * ⚠️ ОТДАЁТ ПАРУ, А НЕ ОДИН ОБЪЕКТ. Отметка «сессия жива» нужна
 * зовущему, чтобы решить, пора ли её обновлять, — но в «кто пришёл»
 * ей места нет. Незаявленное поле, приехавшее вместе с правами, однажды
 * прочтут по ошибке — поэтому оно стоит рядом, а не внутри.
 */
export async function findLiveSession(tx: Executor, tokenHash: string, now: Date) {
  const rows = await tx
    .select({
      lastSeenAt: session.lastSeenAt,
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
  const row = rows[0];
  if (!row) return null;
  const { lastSeenAt, ...actor } = row;
  return { actor, lastSeenAt };
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
 *
 * ⚠️ НО УСЛОВИЯ В ЗАПРОСЕ МАЛО, И ВОТ ПОЧЕМУ. Оно избавляет
 * от письма, но не от самого круга до базы и занятого соединения
 * из десяти. Замерено: догон после task-067 не читает реплик вовсе,
 * и вся его цена — два этих запроса (Д-39). Поэтому решение «пора ли»
 * принимается до запроса, по отметке, которую мы и так только что прочли
 * (`staleTouch`), а условие в `UPDATE` остаётся вторым рубежом от гонки
 * двух вкладок.
 */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** Пора ли отмечать сессию живой. Никогда не отмечали — значит пора. */
export function staleTouch(lastSeenAt: Date | null, now: Date): boolean {
  return lastSeenAt === null || lastSeenAt.getTime() < now.getTime() - TOUCH_EVERY_MS;
}

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

/* ── Приглашения (Р-009) ──────────────────────────────────────────────── */

/** Завести приглашение. Наружу отдаётся токен, в базу — только его хеш. */
export async function insertInvite(
  tx: Executor,
  input: {
    workspaceId: string;
    createdBy: string;
    tokenHash: string;
    expiresAt: Date;
    maxUses: number;
  },
) {
  const rows = await tx.insert(invite).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("не удалось завести приглашение");
  return created;
}

/**
 * Погасить приглашение — атомарно.
 *
 * ⚠️ ПРАВО ПРОВЕРЯЕТСЯ ЗДЕСЬ, УСЛОВИЕМ В САМОМ ИЗМЕНЕНИИ, а не проверкой
 * «а можно ли» отдельным запросом: та была бы гонкой. Два устройства
 * с последним оставшимся входом — ровно одно получит строку, второе ноль.
 * Ту же гонку мы уже ловили в отправке сообщений и в кодах моста.
 *
 * ⚠️ ЧЕТЫРЕ ПРИЧИНЫ ОТКАЗА НАРУЖУ НЕ РАЗЛИЧАЮТСЯ: просрочено, отозвано,
 * исчерпано, не существует. Вызывающий видит только «получилось или нет»
 * и отвечает одним и тем же 404 (Р-009) — иначе по разнице ответов
 * переберут живые приглашения.
 */
export async function redeemInvite(tx: Executor, tokenHash: string, now: Date) {
  const rows = await tx
    .update(invite)
    .set({ used: sql`${invite.used} + 1` })
    .where(
      and(
        eq(invite.tokenHash, tokenHash),
        isNull(invite.revokedAt),
        gt(invite.expiresAt, now),
        lt(invite.used, invite.maxUses),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Отозвать своё приглашение. Чужое не находится — как несуществующее. */
export async function revokeInvite(tx: Executor, workspaceId: string, inviteId: string, now: Date) {
  const rows = await tx
    .update(invite)
    .set({ revokedAt: now })
    .where(
      and(eq(invite.id, inviteId), eq(invite.workspaceId, workspaceId), isNull(invite.revokedAt)),
    )
    .returning({ id: invite.id });
  return rows[0] ?? null;
}

/** Участник-агент пространства, если он уже заведён. */
export async function findAgent(tx: Executor, workspaceId: string) {
  const rows = await tx
    .select()
    .from(participant)
    .where(and(eq(participant.workspaceId, workspaceId), eq(participant.kind, "agent")))
    .limit(1);
  return rows[0] ?? null;
}

/* ── мосты: машина участника со своей подпиской (task-001) ───────────── */

export async function insertBridge(
  tx: Executor,
  input: {
    workspaceId: string;
    participantId: string;
    codeHash: string;
    codeExpiresAt: Date;
  },
) {
  const rows = await tx.insert(bridge).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("не удалось завести мост");
  return created;
}

/**
 * Погасить код подключения — атомарно, тем же приёмом, что у приглашений.
 *
 * Одноразовость держится условием внутри самого изменения. Проверка
 * «а не занято ли» отдельным запросом была бы гонкой: две машины
 * с одним кодом получили бы по токену.
 *
 * Все три поля ставятся ОДНИМ запросом — этого требует CHECK в базе,
 * а отложить его нельзя: Postgres не умеет DEFERRABLE для CHECK.
 */
export async function claimBridge(
  tx: Executor,
  input: { codeHash: string; tokenHash: string; name: string; now: Date },
) {
  const rows = await tx
    .update(bridge)
    .set({
      tokenHash: input.tokenHash,
      name: input.name,
      joinedAt: input.now,
      lastSeenAt: input.now,
    })
    .where(
      and(
        eq(bridge.codeHash, input.codeHash),
        isNull(bridge.joinedAt),
        isNull(bridge.revokedAt),
        gt(bridge.codeExpiresAt, input.now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Мост по его постоянному токену. Отозванный не находится. */
export async function findBridgeByToken(tx: Executor, tokenHash: string) {
  const rows = await tx
    .select()
    .from(bridge)
    .where(and(eq(bridge.tokenHash, tokenHash), isNull(bridge.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Отметить, что мост приходил.
 *
 * Пишется на каждый заход за работой — иначе «на связи» врёт. Заходов
 * немного: один на каждые 25 секунд ожидания, а не на каждый запрос
 * человека, поэтому отдельной бережливости, как у сессий, здесь не нужно.
 */
export async function touchBridge(tx: Executor, bridgeId: string, now: Date) {
  await tx.update(bridge).set({ lastSeenAt: now }).where(eq(bridge.id, bridgeId));
}

/** Мосты участника: и подключённые, и ещё не погашенные коды. */
export async function listBridgesOf(tx: Executor, participantId: string) {
  return tx
    .select()
    .from(bridge)
    .where(and(eq(bridge.participantId, participantId), isNull(bridge.revokedAt)))
    .orderBy(desc(bridge.createdAt));
}

/* ── ключи поставщиков модели (Р-016) ────────────────────────────────── */

export async function insertModelKey(
  tx: Executor,
  input: {
    workspaceId: string;
    participantId: string | null;
    provider: string;
    version: number;
    iv: string;
    ciphertext: string;
    tag: string;
    hint: string;
  },
) {
  const rows = await tx.insert(modelKey).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("ключ не записался");
  return row;
}

/**
 * Погасить прежние ключи того же владельца и поставщика.
 *
 * Нужно ДО вставки нового: частичный уникальный индекс разрешает ровно один
 * живой. Без этого повторное сохранение падало бы нарушением индекса,
 * а человек ждёт замены, а не ошибки.
 */
export async function revokeModelKeysOf(
  tx: Executor,
  workspaceId: string,
  participantId: string | null,
  provider: string,
) {
  await tx
    .update(modelKey)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(modelKey.workspaceId, workspaceId),
        participantId === null
          ? isNull(modelKey.participantId)
          : eq(modelKey.participantId, participantId),
        eq(modelKey.provider, provider),
        isNull(modelKey.revokedAt),
      ),
    );
}

/**
 * Живые ключи, доступные участнику: его личные и общие пространства.
 * Чужие личные не попадают сюда никогда — это и есть проверка видимости.
 *
 * Личные идут первыми: `keyFor` берёт первый подошедший.
 */
export async function listModelKeys(tx: Executor, workspaceId: string, participantId: string) {
  return tx
    .select()
    .from(modelKey)
    .where(
      and(
        eq(modelKey.workspaceId, workspaceId),
        isNull(modelKey.revokedAt),
        or(eq(modelKey.participantId, participantId), isNull(modelKey.participantId)),
      ),
    )
    .orderBy(desc(modelKey.participantId), desc(modelKey.createdAt));
}

/** Убрать свой ключ или ключ пространства. Чужой личный не находится. */
export async function revokeModelKeyById(
  tx: Executor,
  workspaceId: string,
  participantId: string,
  id: string,
) {
  const rows = await tx
    .update(modelKey)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(modelKey.id, id),
        eq(modelKey.workspaceId, workspaceId),
        isNull(modelKey.revokedAt),
        or(eq(modelKey.participantId, participantId), isNull(modelKey.participantId)),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
