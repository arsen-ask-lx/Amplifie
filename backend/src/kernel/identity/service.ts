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
function normalizeEmail(raw: string): string {
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

/**
 * Участник-агент пространства. Заводится при первой надобности.
 *
 * Лениво, а не миграцией: миграция не знает, у каких пространств агент
 * уже есть, а засеять всех разом значит завести агента там, где им
 * никогда не воспользуются.
 */
/**
 * Агенты пространства. ТОЛЬКО ЧТЕНИЕ.
 *
 * Отдельно от `ensureAgent` намеренно: тот заводит участника при первом
 * ответе, и звать его из `GET` нельзя. Чтение, которое пишет, однажды
 * заведёт участника от чужого запроса, и в журнале появится событие
 * без причины. Пустой список — честный ответ: агента ещё не звали.
 */
export async function listAgents(
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const found = await repo.findAgent(db, workspaceId);
  return found ? [{ id: found.id, name: found.displayName }] : [];
}

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
