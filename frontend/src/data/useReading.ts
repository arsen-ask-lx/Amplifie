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
const ЗАДЕРЖКА = 3000;

export interface Reading {
  /** Сколько непрочитанного у разговора — с поправкой на нашу отметку. */
  unreadOf: (conversationId: string) => number;
  /**
   * Где рисовать черту «Непрочитанные сообщения» в ОТКРЫТОМ разговоре.
   * `null` — черты нет. Черта стоит перед первой репликой с номером
   * больше этого.
   */
  boundary: number | null;
}

/** Смотрит ли человек на нас прямо сейчас. */
function смотрят(): boolean {
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
  const [прочитано, setПрочитано] = useState<Record<string, number>>({});

  /**
   * ⚠️ ЧЕРТА ЗАМИРАЕТ, И ЭТО ВЕСЬ ЕЁ СМЫСЛ. Она берётся один раз —
   * при открытии разговора — и дальше не двигается, сколько бы реплик
   * ни пришло. Черта, убегающая вниз за каждым новым сообщением, всегда
   * стоит под последним и не отвечает на вопрос «докуда я дочитал».
   * У них она тоже создаётся один раз (`addUnreadBar`) и снимается
   * только уходом из разговора.
   */
  const [boundary, setBoundary] = useState<number | null>(null);
  const открыт = useRef<string | null>(null);

  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  useEffect(() => {
    if (открыт.current === currentId) return;
    открыт.current = currentId;
    const room = currentId ? roomsRef.current.find((one) => one.id === currentId) : undefined;
    // Ноль значит «не читал ничего»: черта встанет перед самой первой
    // чужой репликой. Отсутствие непрочитанного — черты нет вовсе.
    setBoundary(room && room.unread > 0 ? room.readSeq : null);
  }, [currentId]);

  /** Отложенная отправка: пока человек листает, номера копятся в одну. */
  const таймер = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ждёт = useRef<{ id: string; seq: number } | null>(null);

  const отправить = useCallback(async () => {
    const заказ = ждёт.current;
    ждёт.current = null;
    if (!заказ) return;
    try {
      const { unread } = await api.markRead(заказ.id, заказ.seq);
      // Число с сервера точнее нашего: он видит весь разговор, мы — окно.
      setПрочитано((было) => ({ ...было, [заказ.id]: заказ.seq }));
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
  const планировать = useCallback(
    (id: string, последний: number) => {
      if (!following.current || !смотрят()) return;
      const room = roomsRef.current.find((one) => one.id === id);
      const уже = прочитано[id] ?? room?.readSeq ?? 0;
      if (последний <= уже) return;

      ждёт.current = { id, seq: последний };
      clearTimeout(таймер.current);
      // Полное обнуление уходит сразу: его видит глаз. Всё остальное
      // копится — человек листает, а не читает по одной реплике.
      if ((room?.unread ?? 0) > 0) void отправить();
      else таймер.current = setTimeout(() => void отправить(), ЗАДЕРЖКА);
    },
    [прочитано, following, отправить],
  );

  const последний = messages.at(-1)?.seq;

  useEffect(() => {
    if (!currentId || последний === undefined) return;

    const запланировать = () => планировать(currentId, последний);

    запланировать();
    // Вернулся к вкладке — самое время отметить: до этого мы намеренно
    // молчали, даже если лента всё это время стояла внизу.
    document.addEventListener("visibilitychange", запланировать);
    window.addEventListener("focus", запланировать);
    return () => {
      document.removeEventListener("visibilitychange", запланировать);
      window.removeEventListener("focus", запланировать);
    };
  }, [currentId, последний, планировать]);

  const unreadOf = useCallback(
    (conversationId: string) => {
      const room = roomsRef.current.find((one) => one.id === conversationId);
      if (!room) return 0;
      const наш = прочитано[conversationId];
      if (наш === undefined) return room.unread;
      // Сервер мог посчитать до нашей отметки — вычитаем то, что успели
      // прочесть сами. Ниже нуля не опускаемся: число не бывает
      // отрицательным, а гонка возможна.
      const съедено = messages.filter(
        (one) =>
          one.conversationId === conversationId &&
          one.seq > room.readSeq &&
          one.seq <= наш &&
          one.author.id !== meId,
      ).length;
      return Math.max(0, room.unread - съедено);
    },
    [прочитано, messages, meId],
  );

  return { unreadOf, boundary };
}
