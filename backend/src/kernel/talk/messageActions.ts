/**
 * Действия над одной репликой: правка, удаление, закреп и закреплённое чата.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `service.ts`, КОГДА ТОТ ПЕРЕВАЛИЛ ПРЕДЕЛ В 800 СТРОК (Д-66).
 * Шов по вопросу, а не по числу строк: `service.ts` отвечает «как разговор
 * живёт и доставляется», а здесь — «что человек делает с уже сказанным»
 * и кто на это вправе (своё, модератор, любой видящий для закрепа).
 */
import { change } from "../../platform/change.js";
import { db, type Executor } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import { ConversationNotVisibleError, requireVisible, type Viewer } from "./access.js";
import { mentionedWhoSee, setMentions } from "./mentions.js";
import * as repo from "./repo.js";
import { type MessageView, presentMessage, viewOf } from "./service.js";

/** Сообщение не моё, не существует или удалено — снаружи всё это «нет». */
async function requireMine(tx: Executor, viewer: Viewer, messageId: string) {
  const found = await repo.findMessage(tx, messageId);
  if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
  // «Не твоё» и «нет такого» — один ответ: иначе выдаём, что оно существует.
  if (found.authorParticipantId !== viewer.participantId) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  return found;
}

/**
 * Удалить можно своё — и чужое, если человек здесь модерирует (Р-035).
 * Для остальных чужое — «нет такого», как и прежде.
 */
async function requireDeletable(tx: Executor, viewer: Viewer, messageId: string) {
  const found = await repo.findMessage(tx, messageId);
  if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
  await requireVisible(tx, viewer, found.conversationId);
  if (found.authorParticipantId === viewer.participantId) return { found, moderated: false };
  if (await repo.canModerate(tx, found.conversationId, viewer.participantId)) {
    return { found, moderated: true };
  }
  throw new ConversationNotVisibleError();
}

/**
 * Событие о реплике в журнал — без текста: журнал живёт дольше сообщения
 * и читается шире разговора.
 */
async function logMessageEvent(
  tx: Executor,
  viewer: Viewer,
  kind: string,
  messageId: string,
  found: { conversationId: string; seq: bigint | number | string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  await appendEvent(tx, {
    kind,
    workspaceId: viewer.workspaceId,
    actorParticipantId: viewer.participantId,
    subjectType: "message",
    subjectId: messageId,
    payload: { conversationId: found.conversationId, seq: Number(found.seq), ...extra },
  });
}

/** Изменить своё сообщение. Отметку «изменено» ставит хранилище. */
export async function editMessage(
  viewer: Viewer,
  messageId: string,
  body: string,
): Promise<MessageView> {
  return change(
    viewer.workspaceId,
    async (tx) => {
      const found = await requireMine(tx, viewer, messageId);
      const changed = await repo.updateMessageBody(tx, viewer.workspaceId, messageId, body);
      if (!changed) throw new ConversationNotVisibleError();

      // Убрал упоминание — значок у человека гаснет.
      await setMentions(tx, messageId, await mentionedWhoSee(tx, found.conversationId, body));

      await logMessageEvent(tx, viewer, "message.edited", messageId, found);
      return viewOf(tx, messageId);
    },
    (view) => view.conversationId,
  );
}

/** Удалить своё сообщение — мягко: на него ссылаются ответы и пересылки. */
export async function deleteMessage(viewer: Viewer, messageId: string): Promise<void> {
  await change(
    viewer.workspaceId,
    async (tx) => {
      const { found, moderated } = await requireDeletable(tx, viewer, messageId);
      const gone = await repo.softDeleteMessage(tx, viewer.workspaceId, messageId);
      if (!gone) throw new ConversationNotVisibleError();

      // Актор — удаливший; признак говорит, что сообщение было чужим (Р-035).
      await logMessageEvent(
        tx,
        viewer,
        "message.deleted",
        messageId,
        found,
        moderated ? { moderated } : {},
      );

      // Возвращаем адрес, а не void: звонок обязан знать, где изменилось.
      return found.conversationId;
    },
    (where) => where,
  );
}

/** Закрепить или открепить — любому, кому виден разговор, как в Телеграме и Слаке. */
export async function pinMessage(
  viewer: Viewer,
  messageId: string,
  pinned: boolean,
): Promise<void> {
  await change(
    viewer.workspaceId,
    async (tx) => {
      const found = await repo.findMessage(tx, messageId);
      if (!found || found.deletedAt !== null) throw new ConversationNotVisibleError();
      await requireVisible(tx, viewer, found.conversationId);

      // Повтор — не ошибка: результат тот же.
      await repo.setPinned(tx, viewer.workspaceId, messageId, pinned ? new Date() : null);

      /**
       * Потолок (Р-045) — только для НОВОГО закрепления: повтор места не занимает.
       *
       * ⚠️ СЧИТАЕМ ПОСЛЕ ЗАПИСИ, А НЕ ДО. Запись берёт замок строки пространства
       * (номер изменения), и все записи пространства идут по одной. Подсчёт до
       * записи шёл без замка: четверо одновременно у 99 видели 99 и проходили
       * все — выходило 103 (найдено ревью open-code-review, Р-046). После записи
       * подсчёт видит всех, кто прошёл раньше; лишний откатывается целиком.
       */
      if (
        pinned &&
        found.pinnedAt === null &&
        (await repo.countPinned(tx, found.conversationId)) > PIN_LIMIT
      ) {
        throw new PinLimitError();
      }

      await logMessageEvent(
        tx,
        viewer,
        pinned ? "message.pinned" : "message.unpinned",
        messageId,
        found,
      );

      return found.conversationId;
    },
    (where) => where,
  );
}

/**
 * Сколько реплик можно закрепить в одном чате (Р-045) — как у Slack.
 * Сто первое сервер не принимает и называет причину: открепи старое.
 */
const PIN_LIMIT = 100;

/** Потолок закреплённого достигнут — отказ с причиной, а не молчаливое «ок». */
export class PinLimitError extends Error {}

/** Закреплённое разговора, свежее сверху. */
export async function listPinned(viewer: Viewer, conversationId: string) {
  await requireVisible(db, viewer, conversationId);
  const rows = await repo.listPinned(db, conversationId, PIN_LIMIT);
  return { items: rows.map(presentMessage) };
}
