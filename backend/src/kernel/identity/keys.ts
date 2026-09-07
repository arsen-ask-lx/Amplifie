import { db, withTransaction } from "../../platform/db.js";
import { keyringFromEnv, open, seal } from "../../platform/secrets.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";

/**
 * Ключи поставщиков модели: личный участника и общий для пространства.
 *
 * Устройство хранения — Р-016. Здесь только правила: чей ключ, какой формы,
 * кто его видит и что уходит наружу.
 *
 * ⚠️ ОТКРЫТЫЙ КЛЮЧ ВЫХОДИТ ОТСЮДА РОВНО ОДНИМ СПОСОБОМ — `keyFor`,
 * и только внутрь процесса, в момент вызова модели. Ни `listKeys`,
 * ни события, ни ошибки его не содержат.
 */

/** Ключ не отдаётся: наружу идёт только это. */
export interface KeyView {
  id: string;
  provider: string;
  /** Последние знаки. Узнать можно, воспользоваться — нет. */
  hint: string;
  scope: "участник" | "пространство";
  createdAt: Date;
}

export type Scope = "участник" | "пространство";

export class BadKeyFormatError extends Error {}
export class NoSecretKeyError extends Error {}

/**
 * Как выглядит ключ у поставщика.
 *
 * Проверяем форму ДО сохранения: опечатка, найденная сразу, дешевле
 * молчаливого отказа модели через неделю. Проверка нарочно грубая —
 * префикс и длина. Точную форму знает только поставщик, и гнаться
 * за ней значит однажды отвергнуть законный ключ нового поколения.
 */
const SHAPES: Record<string, { prefix: string; least: number }> = {
  anthropic: { prefix: "sk-ant-", least: 20 },
  openai: { prefix: "sk-", least: 20 },
};

/** Сколько последних знаков показываем. Держится ещё и проверкой в базе. */
const HINT = 4;

function shapeOf(provider: string, key: string): void {
  const shape = SHAPES[provider];
  if (!shape) throw new BadKeyFormatError(`неизвестный поставщик: ${provider}`);
  if (!key.startsWith(shape.prefix) || key.length < shape.least) {
    // В тексте ошибки — ТОЛЬКО ожидаемый префикс. Ни куска самого ключа,
    // ни его длины: сообщение об ошибке уходит в лог и на экран.
    throw new BadKeyFormatError(`ключ ${provider} начинается с «${shape.prefix}»`);
  }
}

function keyring() {
  const found = keyringFromEnv(process.env);
  if (!found) {
    // Не «ключ не сохранился», а «сервер не настроен». Разные починки:
    // первое чинит человек, второе — тот, кто поднимал стенд.
    throw new NoSecretKeyError("AMPLIFIE_SECRET_KEY не задан — шифровать нечем");
  }
  return found;
}

/** Владелец записи одним значением: участник либо само пространство. */
function ownerOf(workspaceId: string, participantId: string | null): string {
  return participantId ?? workspaceId;
}

function present(row: Awaited<ReturnType<typeof repo.listModelKeys>>[number]): KeyView {
  return {
    id: row.id,
    provider: row.provider,
    hint: row.hint,
    scope: row.participantId ? "участник" : "пространство",
    createdAt: row.createdAt,
  };
}

/**
 * Сохранить ключ. Повторное сохранение того же поставщика ЗАМЕНЯЕТ прежний,
 * а не заводит второй: иначе человек не знает, каким из двух он платит.
 */
export async function saveKey(
  actor: { workspaceId: string; participantId: string },
  input: { provider: string; key: string; scope: Scope },
): Promise<KeyView> {
  shapeOf(input.provider, input.key);

  const owner = input.scope === "участник" ? actor.participantId : null;
  const sealed = seal(
    input.key,
    {
      workspaceId: actor.workspaceId,
      ownerId: ownerOf(actor.workspaceId, owner),
      provider: input.provider,
    },
    keyring(),
  );

  const saved = await withTransaction(async (tx) => {
    await repo.revokeModelKeysOf(tx, actor.workspaceId, owner, input.provider);

    const created = await repo.insertModelKey(tx, {
      workspaceId: actor.workspaceId,
      participantId: owner,
      provider: input.provider,
      hint: input.key.slice(-HINT),
      ...sealed,
    });

    await appendEvent(tx, {
      kind: "model_key.added",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      subjectType: "model_key",
      subjectId: created.id,
      // Поставщик, подсказка и чей — и ничего больше. Сам ключ в журнал
      // не попадает: журнал живёт дольше ключа и читается шире.
      payload: { provider: input.provider, hint: created.hint, scope: input.scope },
    });

    return created;
  });

  return present(saved);
}

/** Что видит участник: свои ключи и ключи пространства. Чужие личные — нет. */
export async function listKeys(actor: {
  workspaceId: string;
  participantId: string;
}): Promise<KeyView[]> {
  const rows = await repo.listModelKeys(db, actor.workspaceId, actor.participantId);
  return rows.map(present);
}

/**
 * Убрать ключ. Чужой личный не убирается — снаружи это неотличимо
 * от «такого ключа нет», и так и должно быть.
 */
export async function revokeKey(
  actor: { workspaceId: string; participantId: string },
  id: string,
): Promise<boolean> {
  const removed = await withTransaction(async (tx) => {
    const gone = await repo.revokeModelKeyById(tx, actor.workspaceId, actor.participantId, id);
    if (!gone) return false;

    await appendEvent(tx, {
      kind: "model_key.revoked",
      workspaceId: actor.workspaceId,
      actorParticipantId: actor.participantId,
      subjectType: "model_key",
      subjectId: id,
      payload: { provider: gone.provider, hint: gone.hint },
    });
    return true;
  });

  return removed;
}

/** Открытый ключ и его подсказка. Единственный выход наружу этого модуля. */
export interface UsableKey {
  provider: string;
  key: string;
  hint: string;
  scope: Scope;
}

/**
 * Чем этот участник может расплатиться: сперва свой ключ, потом ключ
 * пространства. Порядок из Р-016.
 *
 * ⚠️ Возвращает ОТКРЫТЫЙ ключ. Вызывается только из места вызова модели
 * и никогда — из витрины.
 */
export async function keyFor(actor: {
  workspaceId: string;
  participantId: string;
}): Promise<UsableKey | null> {
  const rows = await repo.listModelKeys(db, actor.workspaceId, actor.participantId);
  // Свой раньше общего: человек, поставивший ключ, ожидает платить им.
  const chosen = rows.find((one) => one.participantId) ?? rows[0];
  if (!chosen) return null;

  return {
    provider: chosen.provider,
    key: open(
      chosen,
      {
        workspaceId: chosen.workspaceId,
        ownerId: ownerOf(chosen.workspaceId, chosen.participantId),
        provider: chosen.provider,
      },
      keyring(),
    ),
    hint: chosen.hint,
    scope: chosen.participantId ? "участник" : "пространство",
  };
}
