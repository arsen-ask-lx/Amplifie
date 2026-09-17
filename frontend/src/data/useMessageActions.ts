import { useCallback, useRef, useState } from "react";
import { troubleOf } from "../shared/trouble.js";
import { api, type Me, type Message, type Quote } from "./api.js";
import { type Local, maxSeq } from "./feed.js";
import type { FeedCommand } from "./feedState.js";

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
  send: (body: string, clientMsgId: string, scope?: "conversation" | "project") => Promise<void>;
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
  messagesRef,
}: {
  currentId: string | null | undefined;
  me: Me;
  dispatch: (command: FeedCommand) => void;
  /** Лента на сейчас — для номера черновика, без перерисовки на каждое её изменение. */
  messagesRef: { current: Local[] };
}): MessageActions {
  const [agentFailure, setAgentFailure] = useState<string | null>(null);
  /** На что сейчас отвечаем. `null` — обычная отправка. */
  const [replying, setReplying] = useState<Quote | null>(null);

  // Через ссылку, а не через зависимость: иначе `send` пересоздавался бы
  // на каждый выбор цитаты, а вместе с ним — обработчик поля ввода.
  const replyingRef = useRef<Quote | null>(null);
  replyingRef.current = replying;

  const send = useCallback(
    async (
      body: string,
      clientMsgId: string,
      scope: "conversation" | "project" = "conversation",
    ) => {
      if (!currentId) return;

      /**
       * ⚠️ РЕПЛИКА ПОЯВЛЯЕТСЯ ДО ОТВЕТА СЕРВЕРА, И ЭТО НЕ УКРАШЕНИЕ.
       * Раньше поле ввода ждало ответа, а неудачу показывало полосой над
       * собой — «Сообщение не ушло». Так не делает ни один мессенджер,
       * и не зря: полоса говорит о СОБЫТИИ, а сломалось КОНКРЕТНОЕ
       * сообщение, и человеку нужно видеть какое. В Телеграме реплика
       * встаёт в ленту сразу с часиками, а неудача помечается на ней же.
       *
       * Номер на пол-деления больше последнего: место в ленте занимается
       * сразу, а настоящий номер приедет с сервера. Дробь безопасна —
       * сортировка числовая, а курсор догона берётся не отсюда.
       */
      const draft: Local = {
        // ⚠️ ИМЯ ЧЕРНОВИКА — ЕГО СОБСТВЕННЫЙ КЛЮЧ, и настоящий `id`
        // приедет с сервера позже. Оба поля заполнены сразу, поэтому
        // опознать реплику можно с первой миллисекунды.
        id: clientMsgId,
        clientMsgId,
        conversationId: currentId,
        body,
        kind: "human",
        /**
         * ⚠️ НОМЕР СЧИТАЕТСЯ ПО ЭТОЙ КОМНАТЕ, А НЕ ПО ВСЕЙ ЛЕНТЕ. В
         * состоянии лежат реплики ВСЕХ комнат сразу (наружу они уходят
         * отфильтрованными), и общий максимум брался из чужого разговора.
         * В пустом канале черновик получал номер на сотню больше соседей
         * и прыгал по ленте, когда приезжал настоящий.
         */
        seq: maxSeq(messagesRef.current.filter((one) => one.conversationId === currentId)) + 0.5,
        createdAt: new Date().toISOString(),
        editedAt: null,
        pinnedAt: null,
        // Цитата в черновике — та же, что человек видит над полем ввода:
        // строить её заново из ответа сервера значило бы показать сперва
        // реплику без цитаты, а потом с ней.
        replyTo: replyingRef.current,
        forwardedFrom: null,
        author: {
          id: me.participant.id,
          name: me.participant.displayName,
          kind: me.participant.kind,
        },
        state: "идёт",
      };
      dispatch({ type: "drafted", draft });

      let sent: Message;
      try {
        sent = await api.send(currentId, body, clientMsgId, {
          ...(replyingRef.current ? { replyToId: replyingRef.current.id } : {}),
        });
      } catch {
        // Помечаем ту самую реплику и уходим. Ключ идемпотентности у неё
        // прежний, поэтому повтор не задвоит её на сервере.
        dispatch({ type: "notSent", clientMsgId });
        return;
      }

      // Ответ отдан: строка над полем ввода больше не нужна.
      setReplying(null);

      // Черновик заменяется настоящей записью: у неё свой идентификатор
      // и настоящий номер. Держать обе — значит однажды показать обе.
      dispatch({ type: "sent", clientMsgId, message: sent });

      // Зовём агента ВСЕГДА, а решает сервер.
      //
      // Почему не проверять обращение здесь: правило «звали ли агента»
      // должно жить в одном месте, иначе две копии разъедутся. Без
      // обращения сервер отвечает 204 мгновенно и молча.
      //
      // ⚠️ БЕЗ await: `send` обязан завершиться, как только сообщение
      // записано. Первая редакция ждала здесь ответа модели — и поле ввода
      // держало набранный текст все пять секунд, будто отправка не прошла.
      // Найдено живым прогоном, тесты этого видеть не могли.
      setAgentFailure(null);
      void (async () => {
        try {
          // Ответ агента НЕ вклеиваем руками: он приедет тем же путём, что
          // и чужие сообщения — звонком и догоном через /v1/sync. Второй
          // путь доставки разошёлся бы с первым, и разошёлся бы молча.
          await api.ask(currentId, scope);
        } catch (error) {
          setAgentFailure(agentTrouble(error));
        }
      })();
    },
    [currentId, me, dispatch, messagesRef],
  );

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

  return { send, agentFailure, replying, reply, pin, edit, remove, forward };
}
