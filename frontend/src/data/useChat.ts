import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { feedTroubleOf, screenTroubleOf } from "../shared/trouble.js";
import { api, type Conversation, type Me, type Message } from "./api.js";
import type { Local } from "./feed.js";
import { FEED_PAGE, pageAround, pageLatest } from "./feedPages.js";
import { emptyFeed, feedState } from "./feedState.js";
import { type Focus, useAddress } from "./useAddress.js";
import { useFeedSync } from "./useFeedSync.js";
import { type MessageActions, useMessageActions } from "./useMessageActions.js";
import { type Panel, usePanel } from "./usePanel.js";
import { useReading } from "./useReading.js";
import { useRooms } from "./useRooms.js";

/**
 * Лента разговора: загрузка, догон и живые обновления.
 *
 * Живое и восстановление после разрыва идут ОДНИМ путём — через `/v1/sync`
 * по номеру (Р-006). Поток `/v1/stream` только звонит: «что-то изменилось».
 * Второй путь доставки разошёлся бы с первым, и разошёлся бы молча.
 *
 * ⚠️ КАКОЙ РАЗГОВОР ОТКРЫТ — ЖИВЁТ В АДРЕСЕ, А НЕ ЗДЕСЬ (Р-019). До task-012
 * это был `useState`, и потому ссылку на разговор дать было нечем, «назад»
 * не работало, а обновление страницы выкидывало в первый канал. Держать
 * ещё и копию в состоянии нельзя: два источника правды о том, где человек
 * находится, — это ровно тот случай, когда они разойдутся молча.
 */

export type { Focus };

/**
 * Отказ загрузки — отдельно от беды живых обновлений (task-096).
 *
 * ⚠️ СВОЯ СТРОКА, А НЕ ОБЩАЯ ЯЧЕЙКА. В одной ячейке беда потока затирала
 * отказ ленты, а погаснув, стирала и его: пустой чат без объяснения
 * и без «Повторить».
 */
export interface LoadFailure {
  /** Что не загрузилось: строку ленты гасит новая загрузка ленты, но не панели. */
  of: "панель" | "лента" | "раннее" | "позднее";
  text: string;
  /** Есть, только если повтор имеет смысл — сервер был недоступен. */
  retry?: () => void;
}

export interface Chat
  extends Pick<
    MessageActions,
    "send" | "agentFailure" | "replying" | "reply" | "pin" | "edit" | "remove" | "forward"
  > {
  conversations: Conversation[];
  current: Conversation | null;
  messages: Local[];
  hasOlder: boolean;
  /** Лента открыта не в конце — за верхним краем есть новее (task-099). */
  hasNewer: boolean;
  loading: boolean;
  failure: LoadFailure | null;
  /** Беда живых обновлений: гаснет сама, повтор идёт без человека. */
  trouble: string | null;
  focus: Focus | null;
  select: (id: string) => void;
  /** Открыть разговор на конкретной реплике — переход по цитате. */
  openAt: (conversationId: string, seq: number) => void;
  loadOlder: () => Promise<void>;
  /** Долистать вперёд, к живому концу. */
  loadNewer: () => Promise<void>;
  /** Вернуться к концу разговора из давнего: кнопкой, не листанием. */
  toLatest: () => void;
  /**
   * Лента говорит, внизу ли человек. От этого зависит, вытесняется ли
   * старое сверху: у листающего назад — не вытесняется (Р-023).
   */
  follow: (yes: boolean) => void;
  /**
   * Боковая панель ОДНИМ предметом (task-035).
   *
   * ⚠️ НЕ ПО ПОЛЮ, И ЭТО ГЛАВНОЕ ЗДЕСЬ. Раньше отсюда наружу торчали
   * `projects`, `unreadOf`, `mentionsOf`, `moveToProject` и ещё пять
   * свойств, и каждое новое умение панели проходило три файла насквозь.
   * Теперь оболочка передаёт целое и о содержимом не знает.
   */
  panel: Panel;
  /**
   * Перед какой репликой стоит черта «Непрочитанные сообщения»
   * в открытом разговоре. `null` — черты нет. Замирает при открытии.
   */
  boundary: number | null;
  /** Закреплённое этого разговора, свежее сверху. */
  pinned: Message[];
  addChannel: (title: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  addThread: (title: string) => Promise<void>;
}

/**
 * @param onSessionEnded — сервер перестал узнавать печеньку (401 на потоке
 *   или догоне). Решает не лента, а приложение: ему показывать вход.
 */
export function useChat(me: Me, onSessionEnded: () => void = () => undefined): Chat {
  /**
   * Лента, закреплённое и «есть ли старше» — одним редьюсером (task-098).
   * Меняются они только командами: как лента отвечает на «пришла страница»
   * или «черновик ушёл», знает `feedState`, а не каждое место отдельно.
   */
  const [feed, dispatch] = useReducer(feedState, emptyFeed);
  const { messages, pinned, hasOlder, hasNewer } = feed;
  /** Не в конце ли лента — ссылкой, для эффекта загрузки и отметки прочтения. */
  const hasNewerRef = useRef(hasNewer);
  hasNewerRef.current = hasNewer;
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  /** Попытка загрузки ленты — «Повторить» двигает её, и эффект спрашивает заново. */
  const [feedAttempt, setFeedAttempt] = useState(0);

  /** Кнопка «Повторить» — только когда сервер был недоступен: 4xx повтор не лечит. */
  const failed = useCallback(
    (of: LoadFailure["of"], text: string, error: unknown, retry: () => void) => {
      setFailure(
        screenTroubleOf(error) === "сервер-недоступен" ? { of, text, retry } : { of, text },
      );
    },
    [],
  );

  // Где человек находится — отдельным знанием (Д-10, task-020).
  // Здесь про адрес больше ничего нет: он выводится из самого адреса,
  // а не хранится рядом с ним вторым способом.
  const where = useAddress();
  const { currentId, currentIdRef, wanted, focus, atRootRef, navigate } = where;

  // Список каналов — отдельным знанием (Д-10, task-020). Лента про него
  // не спрашивает, он про ленту не знает.
  const rooms = useRooms(where, me.participant.id);

  // Что на экране сейчас — для отправки, которой нужен последний номер,
  // но не нужна перерисовка при каждом его изменении.
  const messagesRef = useRef<Local[]>([]);
  messagesRef.current = messages;

  /**
   * Сессия кончилась — ссылкой: приложение передаёт новую функцию на каждой
   * перерисовке, а поток не имеет права переоткрываться из-за этого.
   */
  const sessionEnded = useRef(onSessionEnded);
  sessionEnded.current = onSessionEnded;
  const endSession = useCallback(() => sessionEnded.current(), []);

  /**
   * Чья лента сейчас на экране.
   *
   * ⚠️ БЕЗ ЭТОГО ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛОВ МИГАЛО. Нажатие на «Чат» ведёт
   * на «/», а оттуда адрес подменяется на последний канал — то есть
   * `currentId` успевает сходить в пустоту и вернуться. Эффект ниже
   * видел «идентификатор изменился», обнулял ленту и заново её грузил:
   * человек между двумя кадрами видел «Загружаем…» в уже открытом
   * разговоре. Отметка отвечает на вопрос «а это точно другой разговор?»
   * — и в девяти случаях из десяти отвечает «нет».
   */
  const shown = useRef<string | null>(null);

  /**
   * Человек внизу ленты — значит можно резать сверху.
   *
   * ⚠️ ССЫЛКА, А НЕ СОСТОЯНИЕ: меняется на каждом движении прокрутки,
   * и перерисовывать из-за этого ленту было бы ровно тем, с чем мы
   * боремся. Кто листает назад — у того не режем ничего: он читает
   * то самое, что мы бы выбросили.
   */
  const following = useRef(true);

  // Список разговоров — один раз при входе. `navigate` в зависимостях
  // стоит честно, хотя маршрутизатор и обещает его неизменность: обещание
  // чужой библиотеки — не то, на чём стоит держать единственную загрузку.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ссылки на адрес неизменны, их содержимое читается на момент ответа
  const loadRooms = useCallback(() => {
    setFailure((current) => (current?.of === "панель" ? null : current));
    rooms
      .reload()
      .then((items) => {
        // ⚠️ ЗАГРУЗКА ИДЁТ ЧЕРЕЗ `rooms.reload`, А НЕ СВОИМ ЗАПРОСОМ.
        // Раньше здесь стоял второй вызов `api.conversations()` — тот же
        // запрос, что и в перечитывании списка, только записанный дважды.
        // Одно знание, одно место.
        //
        // Адрес «/» — это «покажи что-нибудь»: подставляем первый разговор
        // ЗАМЕНОЙ записи в истории, чтобы «назад» не возвращал на «/»
        // и не отправлял человека в бесконечную петлю.
        //
        // ⚠️ ТОЛЬКО С «/», И ЭТО НЕ ПРИДИРКА. Первая редакция подставляла
        // разговор всегда, когда адрес его не назвал, — и потому «/board»,
        // набранный руками, немедленно уезжал в первый канал. Поймано
        // живым прогоном: типы были зелёные, экран — нет.
        const first = items[0]?.id;
        if (first && !currentIdRef.current && atRootRef.current) {
          navigate(`/c/${first}`, { replace: true });
        }
        // Выбирать нечего — значит и грузить нечего. Без этой строки экран
        // пустого пространства висел на «Загружаем…» вечно: следующий шаг
        // ждал выбранного разговора, которого нет. Найдено живым прогоном.
        if (items.length === 0) setLoading(false);
      })
      .catch((error: unknown) => {
        failed("панель", "Не удалось загрузить список каналов", error, loadRooms);
        setLoading(false);
      });
  }, [navigate, failed]);

  useEffect(() => loadRooms(), [loadRooms]);

  // Курсор догона, поток и стык страницы с живым — отдельным знанием
  // (task-093, task-099). Выше загрузки ленты: лента зовёт его головой страницы.
  const { settleCursor } = useFeedSync({
    dispatch,
    currentId,
    currentIdRef,
    following,
    rooms,
    onTrouble: setTrouble,
    onSessionEnded: endSession,
  });

  // Лента выбранного разговора — с нуля при каждом переключении.
  // `wanted` в зависимостях: переход по цитате в УЖЕ открытый разговор
  // обязан открыть ленту вокруг реплики, а идентификатор при этом не меняется.
  useEffect(() => {
    if (!currentId) return;
    // Тот же разговор, никуда не ведут и лента в конце — перезагружать нечего.
    // Не в конце — «назад» и щелчок по чату в панели обязаны показать конец.
    if (shown.current === currentId && wanted === null && !hasNewerRef.current) return;

    // Попытка — счётчиком: «Повторить» спрашивает заново тем же эффектом.
    void feedAttempt;
    let cancelled = false;
    // Переход отменяет повторы прежнего чата: терпеливая загрузка иначе
    // ждала бы сервер за разговор, которого на экране уже нет.
    const stop = new AbortController();
    setLoading(true);
    setFailure((current) => (current?.of === "панель" ? current : null));

    const load =
      wanted === null
        ? pageLatest(currentId, stop.signal)
        : pageAround(currentId, wanted, stop.signal);
    load
      .then((page) => {
        if (cancelled) return;

        shown.current = currentId;
        /**
         * ⚠️ ОТВЕТ НА ЗАГРУЗКУ ВЛИВАЕТСЯ В ЛЕНТУ, А НЕ ПОДМЕНЯЕТ ЕЁ.
         *
         * В только что заведённом канале человек успевает отправить
         * первое сообщение РАНЬШЕ, чем долетит ответ на загрузку. Ответ
         * приходит пустым — канал в момент запроса был пуст, — и прямая
         * подстановка стирала уже показанное. Через мгновение реплику
         * возвращал догон: на экране мигание, только у первой реплики
         * и только в новом канале.
         *
         * ⚠️ ПЕРВАЯ ПОПЫТКА ЧИНИТЬ ЭТО БЫЛА НЕВЕРНОЙ, и вот чем. Я
         * переносил только НЕОТПРАВЛЕННОЕ — то, у чего есть метка
         * состояния. Но сервер успевает ответить на отправку раньше, чем
         * на загрузку: к этому мигу реплика уже настоящая, метки на ней
         * нет, и она снова стиралась. Мигание осталось, и владелец
         * поймал его второй раз.
         *
         * Верное правило проще: из ленты уходит только ЧУЖОЕ — то, что
         * осталось от прошлого разговора. Всё, что относится к этому,
         * сливается с ответом по идентификатору, и ответ сервера
         * побеждает при совпадении.
         */
        dispatch({
          type: "loaded",
          conversationId: currentId,
          items: page.items,
          hasMore: page.hasOlder,
          hasNewer: page.hasNewer,
        });
        /**
         * ⚠️ КУРСОР ДОГОНА — ЭТО ГОЛОВА ПРОСТРАНСТВА, А НЕ НОМЕР ИЗ ЭТОЙ
         * КОМНАТЫ. Назад он ходит только к голове, прочитанной сервером
         * до строк страницы (`useFeedSync`, task-099), — никогда к нулю.
         *
         * Сперва здесь стояло `maxSeq(page.items)` — номер самой свежей
         * реплики ОДНОЙ комнаты. У пустой комнаты это ноль, и догон
         * уходил с `after=0`, заново скачивая всё пространство; у тихой
         * комнаты — число далеко позади головы, и он переигрывал историю
         * страницами по пятьдесят. И то и другое замерено в браузере.
         *
         * Голову называет сервер вместе со страницей. Свежая вкладка
         * нигде не была — догонять ей нечего: догон отвечает на вопрос
         * «что изменилось, пока меня не было». История приезжает другим
         * путём, постраничной загрузкой разговора, и он уже написан.
         */
        settleCursor(page.head, !page.hasNewer);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        /**
         * ⚠️ МЁРТВЫЙ АДРЕС УВОДИТ НА ЖИВОЙ ЧАТ, А НЕ ПОКАЗЫВАЕТ ОТКАЗ.
         * Ссылку на чат легко пережить: база стёрта `make reset`, чат
         * удалили, человек вошёл другим. Тогда сервер честно отвечает 404,
         * а экран говорил «Не удалось загрузить сообщения» и висел так
         * (владелец ловил это не раз). Теперь заменяем адрес на «/» —
         * корень сам открывает первый доступный чат.
         */
        // Сессии нет — это не «не загрузилось», а повод показать вход (task-093).
        if (feedTroubleOf(error) === "сессии-нет") {
          endSession();
          return;
        }
        if (feedTroubleOf(error) === "нет-такого") {
          shown.current = null;
          navigate("/", { replace: true });
          return;
        }
        failed("лента", "Не удалось загрузить сообщения", error, () =>
          setFeedAttempt((n) => n + 1),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      stop.abort();
    };
  }, [currentId, settleCursor, wanted, navigate, endSession, failed, feedAttempt]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0]?.seq;
    if (!currentId || oldest === undefined) return;
    try {
      const older = await api.messages(currentId, { limit: FEED_PAGE, before: oldest });
      dispatch({ type: "older", items: older.items, hasMore: older.hasMore });
    } catch (error) {
      // Неудача подгрузки старого не должна ронять экран: человек читает
      // текущее. Но и молчать нельзя — иначе кнопка выглядит сломанной.
      failed("раннее", "Не удалось загрузить более раннее", error, () => void loadOlder());
    }
  }, [currentId, messages, failed]);

  const loadNewer = useCallback(async () => {
    const newest = messages.at(-1)?.seq;
    if (!currentId || newest === undefined) return;
    try {
      const newer = await api.messages(currentId, { limit: FEED_PAGE, after: newest });
      dispatch({ type: "newer", items: newer.items, hasMore: newer.hasMore });
      // Дошли до конца — стык с живым тем же правилом, что у первой страницы.
      if (!newer.hasMore) settleCursor(newer.head, true);
    } catch (error) {
      failed("позднее", "Не удалось загрузить более позднее", error, () => void loadNewer());
    }
  }, [currentId, messages, failed, settleCursor]);

  /**
   * К концу разговора из давнего. Адрес без номера — заменой: «назад» не должен
   * возвращать в давнее, из которого человек только что ушёл.
   */
  const toLatest = useCallback(() => {
    if (!currentId) return;
    shown.current = null;
    setFeedAttempt((n) => n + 1);
    navigate(`/c/${currentId}`, { replace: true });
  }, [currentId, navigate]);

  const select = useCallback(
    (id: string) => {
      setFailure(null);
      navigate(`/c/${id}`);
    },
    [navigate],
  );

  const openAt = useCallback(
    (conversationId: string, seq: number) => {
      setFailure(null);
      navigate(`/c/${conversationId}/${seq}`);
    },
    [navigate],
  );

  /** Закреплённое разговора. Читается отдельной дверью и при каждой смене. */
  useEffect(() => {
    if (!currentId) {
      dispatch({ type: "pinnedLoaded", items: [] });
      return;
    }
    let cancelled = false;
    const stop = new AbortController();
    api
      .pinned(currentId, stop.signal)
      .then(({ items }) => {
        if (!cancelled) dispatch({ type: "pinnedLoaded", items });
      })
      .catch(() => {
        // Полоска закреплённого — не то, ради чего стоит ронять экран.
        // Не приехала — её просто нет, разговор читается дальше.
        if (!cancelled) dispatch({ type: "pinnedLoaded", items: [] });
      });
    return () => {
      cancelled = true;
      stop.abort();
    };
  }, [currentId]);

  /**
   * Лента сообщает, внизу ли человек. Это единственное, что ей нужно
   * рассказать про себя наружу, и рассказывает она это ссылкой:
   * перерисовки от движения прокрутки не происходит.
   */
  const follow = useCallback((yes: boolean) => {
    following.current = yes;
  }, []);

  const actions = useMessageActions({ currentId, me, dispatch, messagesRef });

  /**
   * Отправка из давнего уводит в конец, как у Телеграма: лента становится
   * черновиком (`feedState`, `drafted`), конец привозит загрузка.
   */
  const send = useCallback<Chat["send"]>(
    (...args) => {
      if (hasNewerRef.current) toLatest();
      return actions.send(...args);
    },
    [actions.send, toLatest],
  );

  /**
   * «Человек внизу» для отметки прочтения — только когда лента в конце.
   * Низ давнего отрезка — не низ разговора: отметка оттуда погасила бы
   * непрочитанное, которого человек не видел, а номер назад не ходит.
   */
  const readingFollow = useMemo(
    () => ({
      get current() {
        return following.current && !hasNewerRef.current;
      },
    }),
    [],
  );

  // Лента открытого разговора — одна на возврат наружу и на подсчёт
  // прочитанного: два разных выражения для одного и того же однажды
  // разошлись бы.
  const visible = messages.filter((m) => m.conversationId === currentId);

  // Что человек уже видел — отдельным знанием (Р-029). `useChat` про это
  // ничего не решает: он только даёт номер последней реплики и говорит,
  // внизу ли лента.
  const reading = useReading({
    rooms: rooms.items,
    currentId,
    messages: visible,
    meId: me.participant.id,
    following: readingFollow,
    // ⚠️ СПИСОК БОЛЬШЕ НЕ ПЕРЕЧИТЫВАЕТСЯ ПРИ СМЕНЕ РАЗГОВОРА (task-097).
    // Он чинил число покинутого чата — и не чинил: панель успевала
    // перечитаться раньше, чем уходила отметка. Теперь отметка уходит
    // при переходе сразу, а её ответ ставит серверное число в строку.
    onRead: rooms.readApplied,
  });

  const panel = usePanel({ rooms, reading, currentId, select });

  return {
    conversations: rooms.items,
    current: rooms.items.find((c) => c.id === currentId) ?? null,
    follow,
    ...actions,
    send,
    panel,
    boundary: reading.boundary,
    pinned,
    messages: visible,
    hasOlder,
    hasNewer,
    loading,
    failure,
    trouble,
    focus,
    select,
    openAt,
    loadOlder,
    loadNewer,
    toLatest,
    addChannel: rooms.addChannel,
    removeChannel: rooms.removeChannel,
    addThread: rooms.addThread,
  };
}
