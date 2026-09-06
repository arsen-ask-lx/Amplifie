import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Conversation, type Message } from "./api.js";

/**
 * Лента разговора: загрузка, догон и живые обновления.
 *
 * Живое и восстановление после разрыва идут ОДНИМ путём — через `/v1/sync`
 * по номеру (Р-006). Поток `/v1/stream` только звонит: «что-то изменилось».
 * Второй путь доставки разошёлся бы с первым, и разошёлся бы молча.
 */

const PAGE = 50;

/** Слияние по идентификатору: звонок и ответ на отправку приносят одно и то же. */
function merge(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

const maxSeq = (messages: Message[]) => messages.reduce((top, m) => Math.max(top, m.seq), 0);

export interface Chat {
  conversations: Conversation[];
  current: Conversation | null;
  messages: Message[];
  hasOlder: boolean;
  loading: boolean;
  failure: string | null;
  select: (id: string) => void;
  loadOlder: () => Promise<void>;
  send: (body: string, clientMsgId: string) => Promise<void>;
}

export function useChat(): Chat {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // Курсор догона живёт в ref, а не в состоянии: он меняется чаще, чем экран,
  // и перерисовывать ленту ради него незачем.
  const cursor = useRef(0);

  /** Догон до конца: страницами, пока сервер говорит, что есть ещё. */
  const catchUp = useCallback(async () => {
    for (let page = 0; page < 20; page++) {
      const batch = await api.sync(cursor.current);
      cursor.current = batch.seq;
      if (batch.messages.length > 0) {
        setMessages((current) => merge(current, batch.messages));
      }
      if (!batch.hasMore) return;
    }
  }, []);

  // Список разговоров — один раз при входе.
  useEffect(() => {
    api
      .conversations()
      .then(({ items }) => {
        setConversations(items);
        setCurrentId((chosen) => chosen ?? items[0]?.id ?? null);
        // Выбирать нечего — значит и грузить нечего. Без этой строки экран
        // пустого пространства висел на «Загружаем…» вечно: следующий шаг
        // ждал выбранного разговора, которого нет. Найдено живым прогоном.
        if (items.length === 0) setLoading(false);
      })
      .catch(() => {
        setFailure("Не удалось загрузить список каналов");
        setLoading(false);
      });
  }, []);

  // Лента выбранного разговора — с нуля при каждом переключении.
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);

    api
      .messages(currentId, { limit: PAGE })
      .then(async ({ items, hasMore }) => {
        if (cancelled) return;
        setMessages(items);
        setHasOlder(hasMore);
        cursor.current = maxSeq(items);
        await catchUp();
      })
      .catch(() => {
        if (!cancelled) setFailure("Не удалось загрузить сообщения");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentId, catchUp]);

  // Звонок. EventSource переподключается сам — этим SSE и хорош.
  useEffect(() => {
    const stream = new EventSource("/v1/stream");
    const onChanged = () => {
      catchUp().catch(() => setFailure("Обновления не доходят — обновите страницу"));
    };
    stream.addEventListener("changed", onChanged);
    return () => {
      stream.removeEventListener("changed", onChanged);
      stream.close();
    };
  }, [catchUp]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0]?.seq;
    if (!currentId || oldest === undefined) return;
    try {
      const older = await api.messages(currentId, { limit: PAGE, before: oldest });
      setMessages((current) => merge(current, older.items));
      setHasOlder(older.hasMore);
    } catch {
      // Неудача подгрузки старого не должна ронять экран: человек читает
      // текущее. Но и молчать нельзя — иначе кнопка выглядит сломанной.
      setFailure("Не удалось загрузить более раннее");
    }
  }, [currentId, messages]);

  const send = useCallback(
    async (body: string, clientMsgId: string) => {
      if (!currentId) return;
      // Ответ на отправку — то же самое сообщение, что придёт догоном.
      // Показываем сразу, чтобы своё написанное не ждало оборота через звонок.
      const sent = await api.send(currentId, body, clientMsgId);
      setMessages((current) => merge(current, [sent]));
    },
    [currentId],
  );

  const select = useCallback((id: string) => {
    setFailure(null);
    setCurrentId(id);
  }, []);

  return {
    conversations,
    current: conversations.find((c) => c.id === currentId) ?? null,
    messages: messages.filter((m) => m.conversationId === currentId),
    hasOlder,
    loading,
    failure,
    select,
    loadOlder,
    send,
  };
}
