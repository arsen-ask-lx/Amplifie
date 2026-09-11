import { mentionedIds } from "@amplifie/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Conversation, type Message } from "./api.js";

/**
 * Прочитанное: докуда человек дочитал и что ему ещё не показывали (Р-029).
 *
 * ⚠️ ОТДЕЛЬНОЕ ЗНАНИЕ, А НЕ КУСОК `useChat`. Тот и без того знает шесть
 * вещей сразу (Д-10), и шов здесь проходит по смыслу: лента отвечает
 * на «что показать», прочитанное — на «что человек уже видел». Они
 * встречаются ровно в одном месте — в номере последней реплики.
 *
 * ⚠️ ОТМЕТКА ИДЁТ, ТОЛЬКО ЕСЛИ ЧЕЛОВЕК СМОТРИТ. Три условия разом, и все
 * три взяты у Телеграма (`MainWindow::markingAsRead`): лента внизу,
 * вкладка на виду, окно в фокусе. Без третьего вкладка, забытая открытой
 * на ночь, к утру пометит прочитанным всё, что пришло, — и человек
 * не узнает, что ему писали. Отменить это нечем: номер идёт только
 * вперёд.
 */

/** Сколько ждать, прежде чем сказать серверу. У них — те же 3 секунды. */
const DELAY_MS = 3000;

export interface Reading {
  /** Сколько непрочитанного у разговора — с поправкой на нашу отметку. */
  unreadOf: (conversationId: string) => number;
  /** Сколько раз тут позвали тебя и ты этого не видел — с той же поправкой. */
  mentionsOf: (conversationId: string) => number;
  /**
   * Где рисовать черту «Непрочитанные сообщения» в ОТКРЫТОМ разговоре.
   * `null` — черты нет. Черта стоит перед первой репликой с номером
   * больше этого.
   */
  boundary: number | null;
}

/** Смотрит ли человек на нас прямо сейчас. */
function isWatching(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function useReading({
  rooms,
  currentId,
  messages,
  meId,
  following,
}: {
  rooms: Conversation[];
  currentId: string | null;
  /** Лента ОТКРЫТОГО разговора — та же, что видит человек. */
  messages: Message[];
  meId: string;
  /** Внизу ли лента. Ссылка: прокрутка не имеет права перерисовывать. */
  following: React.RefObject<boolean>;
}): Reading {
  /**
   * Что мы уже отметили сами. Держим рядом с серверным числом, потому что
   * счётчик на экране обязан гаснуть СРАЗУ, не дожидаясь ответа: ждать
   * сервер, чтобы убрать своё же число, — это подвисающий интерфейс.
   * Так же поступает их клиент.
   */
  const [readUpTo, setReadUpTo] = useState<Record<string, number>>({});

  /**
   * ⚠️ ЧЕРТА ЗАМИРАЕТ, И ЭТО ВЕСЬ ЕЁ СМЫСЛ. Она берётся один раз —
   * при открытии разговора — и дальше не двигается, сколько бы реплик
   * ни пришло. Черта, убегающая вниз за каждым новым сообщением, всегда
   * стоит под последним и не отвечает на вопрос «докуда я дочитал».
   * У них она тоже создаётся один раз (`addUnreadBar`) и снимается
   * только уходом из разговора.
   */
  const [boundary, setBoundary] = useState<number | null>(null);
  const openRef = useRef<string | null>(null);

  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  useEffect(() => {
    if (openRef.current === currentId) return;
    openRef.current = currentId;
    const room = currentId ? roomsRef.current.find((one) => one.id === currentId) : undefined;
    // Ноль значит «не читал ничего»: черта встанет перед самой первой
    // чужой репликой. Отсутствие непрочитанного — черты нет вовсе.
    setBoundary(room && room.unread > 0 ? room.readSeq : null);
  }, [currentId]);

  /** Отложенная отправка: пока человек листает, номера копятся в одну. */
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<{ id: string; seq: number } | null>(null);

  const send = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    try {
      const { unread } = await api.markRead(pending.id, pending.seq);
      // Число с сервера точнее нашего: он видит весь разговор, мы — окно.
      setReadUpTo((prev) => ({ ...prev, [pending.id]: pending.seq }));
      if (unread === 0) return;
    } catch {
      // Отметка не дошла — число просто останется. Это БЕЗОПАСНЫЙ отказ:
      // перечитать хуже, чем не заметить, а обратное теряет сообщение
      // навсегда. Поэтому здесь ни повтора, ни жалобы человеку.
    }
  }, []);

  /**
   * Решить, надо ли сказать серверу, и когда.
   *
   * ⚠️ ТРИ УСЛОВИЯ РАЗОМ, И ТРЕТЬЕ — НЕ ПРИДИРКА. Лента внизу, вкладка
   * на виду, окно в фокусе. Без последнего вкладка, забытая открытой
   * на ночь, к утру пометит прочитанным всё пришедшее — и человек
   * не узнает, что ему писали. Отменить нечем: номер идёт только вперёд.
   */
  const schedule = useCallback(
    (id: string, lastSeq: number) => {
      if (!following.current || !isWatching()) return;
      const room = roomsRef.current.find((one) => one.id === id);
      const already = readUpTo[id] ?? room?.readSeq ?? 0;
      if (lastSeq <= already) return;

      pendingRef.current = { id, seq: lastSeq };
      clearTimeout(timer.current);
      // Полное обнуление уходит сразу: его видит глаз. Всё остальное
      // копится — человек листает, а не читает по одной реплике.
      if ((room?.unread ?? 0) > 0) void send();
      else timer.current = setTimeout(() => void send(), DELAY_MS);
    },
    [readUpTo, following, send],
  );

  const lastSeq = messages.at(-1)?.seq;

  useEffect(() => {
    if (!currentId || lastSeq === undefined) return;

    const scheduleNow = () => schedule(currentId, lastSeq);

    scheduleNow();
    // Вернулся к вкладке — самое время отметить: до этого мы намеренно
    // молчали, даже если лента всё это время стояла внизу.
    document.addEventListener("visibilitychange", scheduleNow);
    window.addEventListener("focus", scheduleNow);
    return () => {
      document.removeEventListener("visibilitychange", scheduleNow);
      window.removeEventListener("focus", scheduleNow);
    };
  }, [currentId, lastSeq, schedule]);

  /**
   * Сколько из посчитанного сервером мы успели прочесть сами.
   *
   * ⚠️ ОДНА ПОПРАВКА НА ОБА ЧИСЛА. Сервер мог посчитать до того, как наша
   * отметка до него доехала, — и тогда значок горит на уже прочитанном.
   * Правило вычитания одно и то же для непрочитанного и для упоминаний;
   * разъедься эти два места, одно из чисел однажды перестало бы гаснуть,
   * и заметили бы это глазами, а не проверкой.
   *
   * `годится` отличает вопросы: «любая чужая реплика» или «та, в которой
   * позвали меня».
   */
  const readLocally = useCallback(
    (room: Conversation, ourSeq: number, counts: (one: Message) => boolean) =>
      messages.filter(
        (one) =>
          one.conversationId === room.id &&
          one.seq > room.readSeq &&
          one.seq <= ourSeq &&
          one.author.id !== meId &&
          counts(one),
      ).length,
    [messages, meId],
  );

  /**
   * Число у разговора с поправкой на нашу отметку.
   *
   * Ниже нуля не опускаемся: число не бывает отрицательным, а гонка
   * между нашей отметкой и счётом сервера — возможна.
   */
  const adjusted = useCallback(
    (
      conversationId: string,
      serverCount: (room: Conversation) => number,
      counts: (one: Message) => boolean,
    ) => {
      const room = roomsRef.current.find((one) => one.id === conversationId);
      if (!room) return 0;
      const ourSeq = readUpTo[conversationId];
      if (ourSeq === undefined) return serverCount(room);
      return Math.max(0, serverCount(room) - readLocally(room, ourSeq, counts));
    },
    [readUpTo, readLocally],
  );

  const unreadOf = useCallback(
    (conversationId: string) =>
      adjusted(
        conversationId,
        (room) => room.unread,
        () => true,
      ),
    [adjusted],
  );

  /**
   * ⚠️ КОГО ПОЗВАЛИ — ЧИТАЕТСЯ ИЗ ТЕЛА, И ЭТО НЕ ВТОРОЙ ИСТОЧНИК ПРАВДЫ.
   * Число считает сервер; здесь только поправка на реплики, которые мы
   * держим в окне ленты и уже отметили прочитанными. Запись упоминания
   * общая с сервером (`@amplifie/contract`), поэтому «позвали меня»
   * обе стороны понимают одинаково.
   */
  const mentionsOf = useCallback(
    (conversationId: string) =>
      adjusted(
        conversationId,
        (room) => room.mentions,
        (one) => (meId ? mentionedIds(one.body).includes(meId) : false),
      ),
    [adjusted, meId],
  );

  return { unreadOf, mentionsOf, boundary };
}
