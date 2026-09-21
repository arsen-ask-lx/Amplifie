import { mentionedIds } from "@amplifie/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Conversation, type Message } from "./api.js";
import { type ReadMarks, readMarks } from "./readMarks.js";

/**
 * Прочитанное: докуда человек дочитал и что ему ещё не показывали (Р-029).
 *
 * ⚠️ ОТДЕЛЬНОЕ ЗНАНИЕ, А НЕ КУСОК `useChat`. Тот и без того знает шесть
 * вещей сразу (Д-10), и шов здесь проходит по смыслу: лента отвечает
 * на «что показать», прочитанное — на «что человек уже видел». Они
 * встречаются ровно в одном месте — в номере последней реплики.
 *
 * ⚠️ ПРОЧИТАНО — ЭТО УВИДЕНО (task-107). Лента сообщает наибольший номер,
 * который человек и правда видел на экране, — так же у Telegram Desktop
 * (`ListWidget::paintEvent` → `readInboxTill`). Прежде условием было «лента
 * внизу», и оно гасило счётчик целиком при открытии чата: человек не читал
 * ничего, а непрочитанное исчезало (жалоба владельца 17.09).
 *
 * ⚠️ ДВА УСЛОВИЯ ОСТАЛИСЬ, И ОНИ ВАЖНЫ (`MainWindow::markingAsRead`):
 * вкладка на виду и окно в фокусе. Без них вкладка, забытая открытой
 * на ночь, к утру пометит прочитанным всё пришедшее — и человек
 * не узнает, что ему писали. Отменить это нечем: номер идёт только вперёд.
 */

export interface Reading {
  /** Лента увидела реплики до этого номера включительно (task-107). */
  seen: (seq: number) => void;
  /** Сколько непрочитанного у разговора — с поправкой на нашу отметку. */
  unreadOf: (conversationId: string) => number;
  /** Сколько раз тут позвали тебя и ты этого не видел — с той же поправкой. */
  mentionsOf: (conversationId: string) => number;
}

/** Смотрит ли человек на нас прямо сейчас. */
function isWatching(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Ушли из чата — отметка уходит сейчас, а не через окно, иначе число
 * успевало загореться снова. Экранную отметку ставим в очередь заново:
 * оборванная сетью иначе не ушла бы никогда (разбор критика 21.09).
 */
function leaveChat(marks: ReadMarks, left: string, shown: number | undefined): void {
  if (shown) marks.seen(left, shown);
  marks.flush(left);
}

/** Реплики чатов, чью отметку сервер уже подтвердил, держать больше незачем. */
function forgetConfirmed(
  kept: Record<string, Message[]>,
  rooms: Map<string, Conversation>,
  shown: Record<string, number>,
): void {
  for (const id of Object.keys(kept)) {
    if ((rooms.get(id)?.readSeq ?? 0) >= (shown[id] ?? 0)) delete kept[id];
  }
}

export function useReading({
  rooms,
  currentId,
  messages,
  meId,
  onRead,
}: {
  rooms: Conversation[];
  currentId: string | null;
  /** Лента ОТКРЫТОГО разговора — та же, что видит человек. */
  messages: Message[];
  meId: string;
  /** Сервер подтвердил отметку и назвал остаток — число ставится в панель (task-097). */
  onRead: (conversationId: string, seq: number, unread: number) => void;
}): Reading {
  /**
   * Докуда человек увидел — для ЭКРАНА. Ставится в момент показа, а не ответом
   * сервера (task-108): ждать сервер, чтобы убрать своё же число, — это
   * подвисающий интерфейс. Так же у Telegram (`readInboxTill` ставит число
   * до запроса).
   *
   * ⚠️ ЭКРАН И СЕРВЕР — ДВА РАЗНЫХ ВОПРОСА. Здесь — «что показать»; «что
   * отправить и когда» решает только `readMarks`, и повтор после отказа сети
   * живёт там. Решай хук «уже отправлено» по этой отметке — оборванная
   * отметка терялась бы навсегда (разбор критика 21.09).
   *
   * ⚠️ В REF, А КОПИЯ — В STATE. `seen` читает ref, поэтому его ссылка
   * постоянна, и наблюдатель ленты не пересобирается на каждом шаге прокрутки.
   */
  const shownRef = useRef<Record<string, number>>({});
  const [readUpTo, setReadUpTo] = useState<Record<string, number>>({});

  /** Какой чат открыт сейчас: по смене уходит отложенная отметка прежнего. */
  const openRef = useRef<string | null>(null);

  /**
   * ⚠️ РАЗГОВОР ИЩЕТСЯ ПО СЛОВАРЮ, А НЕ ПЕРЕБОРОМ. Свёрнутый проект
   * складывает числа всех своих чатов, и с перебором каждое перечитывание
   * списка на 5 000 чатов стоило десятков миллионов сравнений — замер
   * 11.09: четверть секунды занятой вкладки на каждое сообщение.
   */
  const byId = useMemo(() => new Map(rooms.map((one) => [one.id, one])), [rooms]);
  const roomsRef = useRef(byId);
  roomsRef.current = byId;

  /**
   * Когда и что сказать серверу — отдельный модуль (task-097): на каждый чат
   * своё окно, в пути не больше одного запроса.
   *
   * ⚠️ СОЗДАЁТСЯ В ЭФФЕКТЕ, А НЕ ПРИ ОТРИСОВКЕ. Двойное монтирование
   * в разработке остановило бы модуль, созданный один раз, навсегда.
   * Уход со страницы чата (настройки) отправляет отложенное сразу:
   * иначе последняя отметка терялась бы вместе с экраном.
   */
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const marks = useRef<ReadMarks | null>(null);
  useEffect(() => {
    const made = readMarks(
      // Ответ сервера ставит в строку точное число; экран уже сдвинут в `seen`.
      (conversationId, seq, unread) => onReadRef.current(conversationId, seq, unread),
      {
        send: api.markRead,
        now: Date.now,
        setTimeout: (run, ms) => window.setTimeout(run, ms),
        clearTimeout: (timer) => window.clearTimeout(timer as number),
      },
    );
    marks.current = made;
    return () => {
      made.flushAll();
      made.stop();
      marks.current = null;
    };
  }, []);

  /**
   * Последние реплики каждого чата, где мы были (task-108, разбор критика).
   *
   * ⚠️ БЕЗ НИХ ЧИСЛО ПОКИНУТОГО ЧАТА ЗАГОРАЛОСЬ СНОВА. Хук видит ленту только
   * открытого чата; ушли — поправке не на чем считаться, и строка прыгала
   * к серверному числу, ещё не знающему отложенной отметки. Правило подсчёта
   * то же (`readLocally`) — меняется только, по каким репликам оно считает.
   * Когда сервер подтвердит отметку, `readSeq` строки сдвинется, и эти реплики
   * сами выпадут из подсчёта: двойного вычитания нет.
   */
  const keptRef = useRef<Record<string, Message[]>>({});
  useEffect(() => {
    const id = messages[0]?.conversationId;
    if (id) keptRef.current[id] = messages;
  }, [messages]);

  useEffect(() => {
    const left = openRef.current;
    if (left === currentId) return;
    if (left && marks.current) leaveChat(marks.current, left, shownRef.current[left]);
    forgetConfirmed(keptRef.current, roomsRef.current, shownRef.current);
    openRef.current = currentId;
  }, [currentId]);

  /**
   * Лента увидела реплики до этого номера — сказать серверу (task-107).
   *
   * ⚠️ ДВА УСЛОВИЯ: вкладка на виду и окно в фокусе. Забытая открытой
   * вкладка иначе пометит прочитанным всё, что придёт за ночь.
   *
   * ⚠️ НОМЕР ТОЛЬКО ВПЕРЁД. Прокрутка вверх не «распрочитывает»: сервер
   * и так двигает отметку только вперёд, но лишний запрос не нужен.
   *
   * Когда именно уйдёт запрос — решает модуль отметок (не чаще раза
   * в три секунды на чат), а не этот хук.
   */
  const seen = useCallback((seq: number) => {
    const id = openRef.current;
    if (!id || !isWatching()) return;
    if (seq <= (roomsRef.current.get(id)?.readSeq ?? 0)) return;
    if (seq > (shownRef.current[id] ?? 0)) {
      shownRef.current = { ...shownRef.current, [id]: seq };
      setReadUpTo(shownRef.current);
    }
    marks.current?.seen(id, seq);
  }, []);

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
      (room.id === currentId ? messages : (keptRef.current[room.id] ?? [])).filter(
        (one) =>
          one.conversationId === room.id &&
          one.seq > room.readSeq &&
          one.seq <= ourSeq &&
          one.author.id !== meId &&
          counts(one),
      ).length,
    [messages, meId, currentId],
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
      const room = roomsRef.current.get(conversationId);
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

  return { unreadOf, mentionsOf, seen };
}
