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

/**
 * Куда смотреть в ленте. Каждый переход рождает НОВЫЙ объект, даже если
 * поля те же: по его смене лента понимает, что надо подсветить реплику
 * ещё раз. Сравнение по значению здесь молча съело бы повторный переход.
 */
export interface Focus {
  conversationId: string;
  seq: number;
}

/**
 * Долистать назад, пока нужная реплика не окажется в ленте.
 *
 * Ограничение по числу страниц, а не «пока не найдём»: цитата может
 * указывать на удалённое сообщение, и тогда цикл вечен.
 */
const BACK_PAGES = 10;

async function pageBackTo(
  conversationId: string,
  start: { items: Message[]; hasMore: boolean },
  want: number,
): Promise<{ items: Message[]; hasMore: boolean }> {
  let all = start.items;
  let more = start.hasMore;

  for (let page = 0; more && page < BACK_PAGES; page++) {
    const oldest = all[0]?.seq;
    if (oldest === undefined || oldest <= want) break;
    const older = await api.messages(conversationId, { limit: PAGE, before: oldest });
    all = merge(all, older.items);
    more = older.hasMore;
  }
  return { items: all, hasMore: more };
}

export interface Chat {
  conversations: Conversation[];
  current: Conversation | null;
  messages: Message[];
  hasOlder: boolean;
  loading: boolean;
  failure: string | null;
  focus: Focus | null;
  select: (id: string) => void;
  /** Открыть разговор на конкретной реплике — переход по цитате. */
  openAt: (conversationId: string, seq: number) => void;
  loadOlder: () => Promise<void>;
  send: (body: string, clientMsgId: string) => Promise<void>;
  addChannel: (title: string) => Promise<void>;
  addThread: (title: string) => Promise<void>;
}

export function useChat(): Chat {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);

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
  // `wanted` в зависимостях: переход по цитате в УЖЕ открытый разговор
  // обязан долистать до реплики, а идентификатор при этом не меняется.
  const wanted = focus?.conversationId === currentId ? focus.seq : null;
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);

    api
      .messages(currentId, { limit: PAGE })
      .then(async (first) => {
        if (cancelled) return;
        const page = wanted === null ? first : await pageBackTo(currentId, first, wanted);
        if (cancelled) return;

        setMessages(page.items);
        setHasOlder(page.hasMore);
        cursor.current = maxSeq(page.items);
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
  }, [currentId, catchUp, wanted]);

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

  /**
   * Новый разговор появляется в списке и сразу открывается.
   *
   * Список перечитывается целиком, а не дополняется ответом: в нём мог
   * появиться и чужой канал, пока мы набирали название. Один запрос
   * дешевле, чем два источника правды о списке.
   */
  const openNew = useCallback(async (make: () => Promise<Conversation>) => {
    const created = await make();
    const { items } = await api.conversations();
    setConversations(items);
    setCurrentId(created.id);
  }, []);

  const addChannel = useCallback(
    async (title: string) => {
      await openNew(() => api.createChannel(title));
    },
    [openNew],
  );

  const addThread = useCallback(
    async (title: string) => {
      // Ветка заводится у КОРНЯ: ветка от ветки не бывает (дерево
      // ровно двухуровневое), и сервер такое всё равно отклонит.
      const room = conversations.find((c) => c.id === currentId);
      const rootId = room?.parentId ?? room?.id;
      if (!rootId) return;
      await openNew(() => api.createThread(rootId, title));
    },
    [conversations, currentId, openNew],
  );

  const select = useCallback((id: string) => {
    setFailure(null);
    setFocus(null);
    setCurrentId(id);
  }, []);

  const openAt = useCallback((conversationId: string, seq: number) => {
    setFailure(null);
    setCurrentId(conversationId);
    setFocus({ conversationId, seq });
  }, []);

  return {
    conversations,
    current: conversations.find((c) => c.id === currentId) ?? null,
    messages: messages.filter((m) => m.conversationId === currentId),
    hasOlder,
    loading,
    failure,
    focus,
    select,
    openAt,
    loadOlder,
    send,
    addChannel,
    addThread,
  };
}
