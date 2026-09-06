import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { db, type Tx, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";
import { hashToken, newToken } from "./tokens.js";

/** Сколько живёт сессия. Продлевать будем позже — сейчас проще некуда. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Хеш пароля. Argon2id — то, что рекомендуют вместо bcrypt с 2015 года.
 * Параметры по умолчанию @node-rs/argon2 соответствуют OWASP.
 */
const ARGON_OPTIONS = { algorithm: 2 } as const;

/**
 * Заглушка для выравнивания времени ответа. Когда почты нет в базе, мы всё
 * равно проверяем пароль против неё — иначе по времени ответа перебирают,
 * кто зарегистрирован.
 */
const DUMMY_HASH = await argonHash("несуществующий-пароль-для-выравнивания", ARGON_OPTIONS);

export class EmailTakenError extends Error {}
export class InvalidCredentialsError extends Error {}

export interface Actor {
  sessionId: string;
  accountId: string;
  email: string;
  participantId: string;
  displayName: string;
  kind: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
}

/** Почта приводится к одному виду ровно здесь, на границе домена. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function newSessionToken(): { token: string; tokenHash: string } {
  const token = newToken();
  return { token, tokenHash: hashToken(token) };
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
}

/**
 * Что ещё нужно сделать в ТОЙ ЖЕ транзакции, что и регистрация.
 *
 * Так модуль identity не узнаёт про существование чата: кто и что довешивает
 * к регистрации, решает слой сборки (app/), а не ядро. Полурегистрация
 * невозможна — либо всё, либо ничего.
 */
export type RegisterHook = (
  tx: Tx,
  created: { workspaceId: string; participantId: string; accountId: string },
) => Promise<void>;

/**
 * Регистрация: аккаунт + пространство + лицо владельца + сессия.
 * Всё в одной транзакции — полурегистрация хуже отсутствующей.
 */
export async function register(
  input: RegisterInput,
  alsoInSameTransaction?: RegisterHook,
): Promise<{ actor: Actor; token: string }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await argonHash(input.password, ARGON_OPTIONS);
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  return withTransaction(async (tx) => {
    if (await repo.findAccountByEmail(tx, email)) throw new EmailTakenError();

    const createdAccount = await repo.insertAccount(tx, email, passwordHash);
    const createdWorkspace = await repo.insertWorkspace(tx, input.workspaceName.trim());
    const createdParticipant = await repo.insertParticipant(tx, {
      workspaceId: createdWorkspace.id,
      accountId: createdAccount.id,
      displayName: input.displayName.trim(),
      role: "owner",
    });
    const createdSession = await repo.insertSession(tx, {
      accountId: createdAccount.id,
      tokenHash,
      expiresAt,
    });

    // Изменение состояния и событие — в одной транзакции. Всегда (Р-2).
    await appendEvent(tx, {
      kind: "workspace.created",
      workspaceId: createdWorkspace.id,
      actorParticipantId: createdParticipant.id,
      originatorAccountId: createdAccount.id,
      accountableAccountId: createdAccount.id,
      subjectType: "workspace",
      subjectId: createdWorkspace.id,
      payload: { name: createdWorkspace.name },
    });
    await appendEvent(tx, {
      kind: "participant.joined",
      workspaceId: createdWorkspace.id,
      actorParticipantId: createdParticipant.id,
      originatorAccountId: createdAccount.id,
      accountableAccountId: createdAccount.id,
      subjectType: "participant",
      subjectId: createdParticipant.id,
      payload: { role: "owner", kind: "human" },
    });

    await alsoInSameTransaction?.(tx, {
      workspaceId: createdWorkspace.id,
      participantId: createdParticipant.id,
      accountId: createdAccount.id,
    });

    return {
      token,
      actor: {
        sessionId: createdSession.id,
        accountId: createdAccount.id,
        email: createdAccount.email,
        participantId: createdParticipant.id,
        displayName: createdParticipant.displayName,
        kind: createdParticipant.kind,
        role: createdParticipant.role,
        workspaceId: createdWorkspace.id,
        workspaceName: createdWorkspace.name,
      },
    };
  });
}

export async function login(
  rawEmail: string,
  password: string,
): Promise<{ actor: Actor; token: string }> {
  const email = normalizeEmail(rawEmail);
  const found = await repo.findAccountByEmail(db, email);

  // Пароль проверяется ВСЕГДА, даже если аккаунта нет: иначе по времени
  // ответа видно, какие почты зарегистрированы.
  const ok = await argonVerify(found?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
  if (!found || !ok) throw new InvalidCredentialsError();

  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  return withTransaction(async (tx) => {
    await repo.insertSession(tx, { accountId: found.id, tokenHash, expiresAt });
    const actor = await repo.findLiveSession(tx, tokenHash, new Date());
    if (!actor) throw new InvalidCredentialsError();

    await appendEvent(tx, {
      kind: "session.opened",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      originatorAccountId: actor.accountId,
      accountableAccountId: actor.accountId,
      subjectType: "session",
      subjectId: actor.sessionId,
    });

    return { token, actor };
  });
}

export async function logout(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await withTransaction(async (tx) => {
    const actor = await repo.findLiveSession(tx, tokenHash, new Date());
    await repo.deleteSessionByTokenHash(tx, tokenHash);
    if (actor) {
      await appendEvent(tx, {
        kind: "session.closed",
        workspaceId: actor.workspaceId,
        actorParticipantId: actor.participantId,
        originatorAccountId: actor.accountId,
        accountableAccountId: actor.accountId,
        subjectType: "session",
        subjectId: actor.sessionId,
      });
    }
  });
}

/**
 * Куда сообщать о неудачной отметке «сессия жива». Ставится один раз при
 * сборке приложения. Зависимость от абстракции, а не от конкретного логгера
 * (SOLID-D): ядро не знает, чем логирует витрина.
 */
let onTouchFailed: (error: unknown) => void = (error) => {
  // Заглушка по умолчанию НЕ молчит. Пустая функция здесь неотличима от
  // глушения ошибки, а сюда попадают только те случаи, когда витрина забыла
  // подключить настоящего получателя, — то есть сама поломка сборки.
  // emitWarning, а не console: ядро не знает, чем логирует витрина.
  process.emitWarning(
    `отметка «сессия жива» не удалась, а получатель не подключён: ${String(error)}`,
    "AmplifieSessionTouch",
  );
};

export function setSessionTouchFailureReporter(report: (error: unknown) => void): void {
  onTouchFailed = report;
}

/** Кто пришёл. Возвращает null, если сессии нет, она протухла или подделана. */
export async function resolveActor(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;

  // Сравнение с равным временем здесь НЕ нужно и было бы театром: мы не
  // сличаем строки в коде, а ищем по индексу в базе. Утечки по времени
  // на поиске по хешу нет — сам хеш случаен и неугадываем.
  const actor = await repo.findLiveSession(db, hashToken(token), new Date());
  if (!actor) return null;

  // Не ждём: отметка «жив» не должна задерживать ответ. Но и не глотаем
  // молча — проглоченная ошибка это ошибка, которой нет в логах.
  void repo.touchSession(db, actor.sessionId, new Date()).catch((error: unknown) => {
    onTouchFailed(error);
  });
  return actor;
}

/* ── Приглашения (Р-009) ──────────────────────────────────────────────── */

/**
 * Приглашения нет, оно просрочено, отозвано или уже использовано —
 * снаружи это ОДНО И ТО ЖЕ. Различать нельзя: по разнице ответов
 * перебирают живые приглашения.
 */
export class InviteNotUsableError extends Error {}

/** По умолчанию неделя: ссылку передаёт человек, а не почтовый сервер. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Верхняя граница — чтобы «вечная ссылка» не заводилась по недосмотру. */
const INVITE_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Выпустить приглашение.
 *
 * Сырой токен возвращается ОДИН РАЗ и больше не восстановим: в базе лежит
 * только его хеш. Потерял ссылку — выпусти новую, это дешевле, чем хранить
 * значение, которым можно войти.
 */
export async function issueInvite(
  by: { workspaceId: string; participantId: string; accountId: string },
  lifetimeMs: number = INVITE_TTL_MS,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const live = Math.min(Math.max(lifetimeMs, 1000), INVITE_MAX_TTL_MS);
  // Те же 256 бит, что и у токена сессии: это тоже вход в пространство.
  const token = newToken();
  const expiresAt = new Date(Date.now() + live);

  return withTransaction(async (tx) => {
    const created = await repo.insertInvite(tx, {
      workspaceId: by.workspaceId,
      createdBy: by.participantId,
      tokenHash: hashToken(token),
      expiresAt,
    });

    await appendEvent(tx, {
      kind: "invite.issued",
      workspaceId: by.workspaceId,
      actorParticipantId: by.participantId,
      originatorAccountId: by.accountId,
      accountableAccountId: by.accountId,
      subjectType: "invite",
      subjectId: created.id,
      // Ни токена, ни его хеша в журнале: журнал читают, и он вечен.
      payload: { expiresAt: expiresAt.toISOString() },
    });

    return { id: created.id, token, expiresAt };
  });
}

/** Отозвать. Чужое отозвать нельзя — пространство проверяется в запросе. */
export async function revokeInvite(
  by: { workspaceId: string; participantId: string; accountId: string },
  inviteId: string,
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const revoked = await repo.revokeInvite(tx, inviteId, by.workspaceId, new Date());
    if (!revoked) return false;

    await appendEvent(tx, {
      kind: "invite.revoked",
      workspaceId: by.workspaceId,
      actorParticipantId: by.participantId,
      originatorAccountId: by.accountId,
      accountableAccountId: by.accountId,
      subjectType: "invite",
      subjectId: inviteId,
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
 * Что ещё сделать в ТОЙ ЖЕ транзакции, что и вход по приглашению.
 * Через этот шов `app/` заводит новичку членство в канале, а identity
 * по-прежнему ничего не знает про разговоры.
 */
export type JoinHook = (
  tx: Tx,
  created: { workspaceId: string; participantId: string; accountId: string },
) => Promise<void>;

/**
 * Войти по приглашению — ЕДИНСТВЕННЫЙ путь присоединиться к чужому
 * пространству.
 *
 * Регистрация приглашений не принимает никогда. Это не осторожность,
 * а вывод из опубликованного разбора чужой уязвимости: тот же токен,
 * поданный через другой поток входа, обходил там проверку доступа.
 * Один путь — один набор проверок.
 */
export async function joinByInvite(
  input: JoinInput,
  alsoInSameTransaction?: JoinHook,
): Promise<{ actor: Actor; token: string }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await argonHash(input.password, ARGON_OPTIONS);
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const now = new Date();

  const tokenHashOfInvite = hashToken(input.token);

  return withTransaction(async (tx) => {
    // Быстрый отказ: если такого токена нет вовсе, не заводим аккаунт зря.
    // Это НЕ проверка права — право проверит захват ниже своим условием.
    const seen = await repo.peekInvite(tx, tokenHashOfInvite);
    if (!seen) throw new InviteNotUsableError();

    if (await repo.findAccountByEmail(tx, email)) throw new EmailTakenError();

    const createdAccount = await repo.insertAccount(tx, email, passwordHash);
    const createdParticipant = await repo.insertParticipant(tx, {
      workspaceId: seen.workspaceId,
      accountId: createdAccount.id,
      displayName: input.displayName.trim(),
      role: seen.role,
    });

    // ЗАХВАТ. Единственное место, где решается, состоялся ли вход.
    // Оба поля погашения ставятся одним запросом; проигравший получает
    // ноль строк, и вся работа выше откатывается вместе с транзакцией.
    const claimed = await repo.redeemInvite(tx, tokenHashOfInvite, createdParticipant.id, now);
    if (!claimed) throw new InviteNotUsableError();

    const createdSession = await repo.insertSession(tx, {
      accountId: createdAccount.id,
      tokenHash,
      expiresAt,
    });

    await appendEvent(tx, {
      kind: "participant.joined",
      workspaceId: claimed.workspaceId,
      actorParticipantId: createdParticipant.id,
      originatorAccountId: createdAccount.id,
      accountableAccountId: createdAccount.id,
      subjectType: "participant",
      subjectId: createdParticipant.id,
      payload: { role: claimed.role, kind: "human", viaInvite: claimed.id },
    });

    await alsoInSameTransaction?.(tx, {
      workspaceId: claimed.workspaceId,
      participantId: createdParticipant.id,
      accountId: createdAccount.id,
    });

    const space = await repo.findWorkspaceById(tx, claimed.workspaceId);

    return {
      token,
      actor: {
        sessionId: createdSession.id,
        accountId: createdAccount.id,
        email: createdAccount.email,
        participantId: createdParticipant.id,
        displayName: createdParticipant.displayName,
        kind: createdParticipant.kind,
        role: createdParticipant.role,
        workspaceId: claimed.workspaceId,
        workspaceName: space?.name ?? "",
      },
    };
  });
}

/**
 * Участник-агент пространства. Заводится при первой надобности.
 *
 * Лениво, а не миграцией: миграция не знает, у каких пространств агент
 * уже есть, а засеять всех разом значит завести агента там, где им
 * никогда не воспользуются.
 */
export async function ensureAgent(workspaceId: string): Promise<{ id: string }> {
  const existing = await repo.findAgent(db, workspaceId);
  if (existing) return existing;

  return withTransaction(async (tx) => {
    // Проверяем ещё раз внутри транзакции: два одновременных разбора
    // разговора не должны завести двух агентов.
    const again = await repo.findAgent(tx, workspaceId);
    if (again) return again;

    const created = await repo.insertParticipant(tx, {
      workspaceId,
      accountId: null,
      displayName: "Сводка",
      role: "member",
      kind: "agent",
    });

    await appendEvent(tx, {
      kind: "participant.joined",
      workspaceId,
      actorParticipantId: created.id,
      subjectType: "participant",
      subjectId: created.id,
      payload: { role: "member", kind: "agent" },
    });

    return created;
  });
}
