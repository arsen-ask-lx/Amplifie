import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { troubleOf } from "../shared/trouble.js";
import { api, type Me, type Message, type Quote } from "./api.js";
import type { FeedCommand } from "./feedState.js";
import { type Outgoing, sendQueue } from "./sendQueue.js";

/**
 * Что человек делает с репликами: отправить, ответить, поправить, удалить,
 * закрепить, переслать (task-098, Д-10).
 *
 * ⚠️ ОТДЕЛЬНЫМ ЗНАНИЕМ, И ЛЕНТУ ОНО НЕ ТРОГАЕТ РУКАМИ. Хук говорит ленте,
 * что случилось (`dispatch`), а как она от этого меняется, решает
 * `feedState`. Прежде эти действия жили в `useChat` рядом с загрузкой
 * и живыми обновлениями, и все они правили ленту своим `setMessages`.
 */

/**
 * Отказ агента человеческими словами.
 *
 * Отдельной строкой над полем ввода, а НЕ сообщением в ленте: реплика
 * «извините, ошибка» от имени участника — это ложь про то, кто говорил.
 */
const SAYS: Record<string, string> = {
  "нет-модели": "memo не отвечает: не подключена ни одна нейросеть.",
  "мост-молчит": "memo взял вопрос и не ответил вовремя.",
  "модель-отказала": "Нейросеть вернула ошибку. Ответа не будет.",
};

function agentTrouble(error: unknown): string {
  return SAYS[troubleOf(error)] ?? "Не получилось позвать memo.";
}

export interface MessageActions {
  send: (body: string, clientMsgId: string, scope?: "conversation" | "project") => void;
  /** Все «не ушедшие» — ещё раз, тем же ключом и в порядке набора (task-111). */
  retry: () => void;
  /** Не отправлять реплику, которая ещё ждёт (task-111). */
  cancel: (message: Message) => void;
  /** Неотправленное этой вкладки — лента кладёт его поверх записанного. */
  outgoing: readonly Outgoing[];
  /** Почему агент не ответил. Показывается один раз и не как его реплика. */
  agentFailure: string | null;
  /** На что отвечаем прямо сейчас. Строка над полем ввода. */
  replying: Quote | null;
  reply: (message: Message | null) => void;
  pin: (messageId: string, pinned: boolean) => Promise<void>;
  edit: (messageId: string, body: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  forward: (message: Message, toConversationId: string) => Promise<void>;
}

export function useMessageActions({
  currentId,
  me,
  dispatch,
  onSessionEnded,
}: {
  currentId: string | null | undefined;
  me: Me;
  dispatch: (command: FeedCommand) => void;
  /** Сервер не узнал сессию на отправке — решает приложение, как и на потоке. */
  onSessionEnded: () => void;
}): MessageActions {
  /**
   * Почему агент не ответил — и в каком чате. Очередь зовёт агента, когда
   * реплика записана, а это бывает через минуту и в другом открытом чате:
   * чужой отказ под этой лентой был бы враньём про этот разговор.
   */
  const [agentFailure, setAgentFailure] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  /** На что сейчас отвечаем. `null` — обычная отправка. */
  const [replying, setReplying] = useState<Quote | null>(null);

  // Через ссылку, а не через зависимость: иначе `send` пересоздавался бы
  // на каждый выбор цитаты, а вместе с ним — обработчик поля ввода.
  const replyingRef = useRef<Quote | null>(null);
  replyingRef.current = replying;
  // Слушатель очереди живёт дольше смены чата — открытый читает по ссылке.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const sessionEnded = useRef(onSessionEnded);
  sessionEnded.current = onSessionEnded;

  const outgoing = useSyncExternalStore(sendQueue.subscribe, sendQueue.current);

  /**
   * Записанное вливается в ленту, отказ агента встаёт строкой над полем.
   * Подписка живёт, пока открыт экран чата; очередь — дольше: ушёл
   * в настройки — реплики уходят без экрана, а по возвращении лента
   * привезёт их с сервера.
   *
   * ⚠️ В ЛЕНТУ — ТОЛЬКО ЗАПИСЬ ОТКРЫТОГО ЧАТА. Хвост чата A, записанный,
   * пока открыт B, лёг бы в ленту B и сдвинул её края: запись A приедет
   * со страницей A.
   *
   * Ответ агента НЕ вклеиваем руками: он приедет тем же путём, что и чужие
   * сообщения, — звонком и догоном через /v1/sync.
   */
  useEffect(
    () =>
      sendQueue.listen({
        delivered: (item, message) => {
          if (item.conversationId === currentIdRef.current) {
            dispatch({ type: "added", items: [message] });
          }
          setAgentFailure(null);
        },
        agentFailed: (item, error) =>
          setAgentFailure({ conversationId: item.conversationId, text: agentTrouble(error) }),
        sessionEnded: () => sessionEnded.current(),
      }),
    [dispatch],
  );

  const send = useCallback(
    (body: string, clientMsgId: string, scope: "conversation" | "project" = "conversation") => {
      if (!currentId) return;

      /**
       * ⚠️ ЦИТАТА — МОМЕНТА НАБОРА, И СТРОКА ОТВЕТА ГАСНЕТ СРАЗУ (task-111).
       * Раньше цитата читалась после ответа сервера, а строка гасла только
       * после успеха. Пока ответ шёл миллисекунды, разницы не было; в очереди
       * реплика ждёт до минуты, и следующая унесла бы чужую цитату.
       */
      const replyTo = replyingRef.current;
      setReplying(null);
      dispatch({ type: "sending" });

      /**
       * ⚠️ РЕПЛИКА ПОЯВЛЯЕТСЯ ДО ОТВЕТА СЕРВЕРА, И ЭТО НЕ УКРАШЕНИЕ. В
       * Телеграме реплика встаёт в ленту сразу с часиками, а неудача
       * помечается на ней же: сломалось КОНКРЕТНОЕ сообщение, и человеку
       * нужно видеть какое. Черновик рисует лента из очереди (`withDrafts`).
       */
      sendQueue.push({
        clientMsgId,
        conversationId: currentId,
        body,
        replyTo,
        scope,
        author: {
          id: me.participant.id,
          name: me.participant.displayName,
          kind: me.participant.kind,
        },
        createdAt: new Date().toISOString(),
      });
    },
    [currentId, me, dispatch],
  );

  const retry = useCallback(() => sendQueue.retry(), []);
  const cancel = useCallback((message: Message) => sendQueue.cancel(message.clientMsgId), []);

  /**
   * Взять реплику в ответ или отменить ответ.
   *
   * Здесь же рождается цитата: она нужна ДО отправки, чтобы человек видел,
   * на что отвечает. Строить её из ответа сервера значило бы показать сперва
   * реплику без цитаты, а потом с ней.
   */
  const reply = useCallback((message: Message | null) => {
    setReplying(
      message
        ? {
            id: message.id,
            seq: message.seq,
            author: message.author.name,
            excerpt: message.body.replace(/\s+/gu, " ").trim().slice(0, 120),
          }
        : null,
    );
  }, []);

  const pin = useCallback(
    async (messageId: string, next: boolean) => {
      await api.pin(messageId, next);
      // Полоску не перечитываем: закрепление двигает номер изменения,
      // и реплика приедет ближайшим догоном — тем же путём, каким она
      // приезжает всем остальным. Правка на месте ниже нужна только
      // затем, чтобы галочка в меню не мигала до догона.
      dispatch({ type: "pinMarked", messageId, pinnedAt: next ? new Date().toISOString() : null });
    },
    // Разговор здесь больше ни при чём: полоску перестраивает догон.
    [dispatch],
  );

  const edit = useCallback(
    async (messageId: string, body: string) => {
      dispatch({ type: "edited", message: await api.edit(messageId, body) });
    },
    [dispatch],
  );

  /**
   * Удалить свою реплику.
   *
   * ⚠️ ЦИТАТЫ НА НЕЁ ГАСЯТСЯ ЗДЕСЬ ЖЕ. Сервер обнуляет ссылку, но чужие
   * реплики уже лежат на экране со старой цитатой — и остались бы с ней
   * до перезагрузки, показывая текст удалённого сообщения.
   */
  const remove = useCallback(
    async (messageId: string) => {
      await api.remove(messageId);
      dispatch({ type: "removed", messageId });
    },
    [dispatch],
  );

  /** Переслать в другой разговор. Тело копируется, источник — ссылкой. */
  const forward = useCallback(
    async (message: Message, toConversationId: string) => {
      const sent = await api.send(toConversationId, message.body, crypto.randomUUID(), {
        forwardedFromId: message.id,
      });
      // Если переслали в открытый разговор — реплика появляется сразу.
      if (toConversationId === currentId) dispatch({ type: "added", items: [sent] });
    },
    [currentId, dispatch],
  );

  return {
    send,
    retry,
    cancel,
    outgoing,
    agentFailure:
      agentFailure && agentFailure.conversationId === currentId ? agentFailure.text : null,
    replying,
    reply,
    pin,
    edit,
    remove,
    forward,
  };
}
