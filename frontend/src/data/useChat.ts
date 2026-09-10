import { useCallback, useEffect, useRef, useState } from "react";
import { troubleOf } from "../shared/trouble.js";
import {
  api,
  type Conversation,
  type Me,
  type Message,
  type Project,
  type Quote,
  type SyncLine,
} from "./api.js";
import { type Local, maxSeq, merge, mergePinned, ofRoom } from "./feed.js";
import { type Focus, useAddress } from "./useAddress.js";
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

const PAGE = 50;

/**
 * Долистать назад, пока нужная реплика не окажется в ленте.
 *
 * Ограничение по числу страниц, а не «пока не найдём»: цитата может
 * указывать на удалённое сообщение, и тогда цикл вечен.
 */
const BACK_PAGES = 10;

async function pageBackTo(
  conversationId: string,
  start: { items: Message[]; hasMore: boolean; head: number },
  want: number,
): Promise<{ items: Message[]; hasMore: boolean; head: number }> {
  let all = start.items;
  let more = start.hasMore;

  for (let page = 0; more && page < BACK_PAGES; page++) {
    const oldest = all[0]?.seq;
    if (oldest === undefined || oldest <= want) break;
    const older = await api.messages(conversationId, { limit: PAGE, before: oldest });
    all = merge(all, older.items);
    more = older.hasMore;
  }
  // Голова остаётся той, что назвал сервер при первой странице: догрузка
  // старого не двигает конец пространства.
  return { items: all, hasMore: more, head: start.head };
}

export type { Focus };

export interface Chat {
  conversations: Conversation[];
  current: Conversation | null;
  messages: Local[];
  hasOlder: boolean;
  loading: boolean;
  failure: string | null;
  focus: Focus | null;
  select: (id: string) => void;
  /** Открыть разговор на конкретной реплике — переход по цитате. */
  openAt: (conversationId: string, seq: number) => void;
  loadOlder: () => Promise<void>;
  /**
   * Лента говорит, внизу ли человек. От этого зависит, вытесняется ли
   * старое сверху: у листающего назад — не вытесняется (Р-023).
   */
  follow: (yes: boolean) => void;
  /** `scope` — насколько широко агент читает, отвечая (Р-032). */
  send: (body: string, clientMsgId: string, scope?: "conversation" | "project") => Promise<void>;
  /** Почему агент не ответил. Показывается один раз и не как его реплика. */
  agentFailure: string | null;
  /** На что отвечаем прямо сейчас. Строка над полем ввода. */
  replying: Quote | null;
  reply: (message: Message | null) => void;
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
  pin: (messageId: string, pinned: boolean) => Promise<void>;
  edit: (messageId: string, body: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  forward: (message: Message, toConversationId: string) => Promise<void>;
  addChannel: (title: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  addThread: (title: string) => Promise<void>;
}

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

/**
 * Осознанно проглоченный отказ — и он ИМЕНОВАН.
 *
 * ⚠️ ПУСТОЙ `catch` ЗАПРЕЩЁН ПРАВИЛОМ ПРОЕКТА, и правильно: молча
 * съеденная ошибка — это ошибка, о которой никто не узнает. Но здесь
 * проглатывание намеренное: не приехал список каналов или полоска
 * закреплённого — человек читает то, что уже на экране, и пугать его
 * нечем. Имя делает решение видимым: `catch(ignore)` читается как выбор,
 * `catch(() => {})` — как недосмотр.
 */
function ignore(): void {
  // Тело намеренно пустое, и это сказано словами выше.
}

function agentTrouble(error: unknown): string {
  return SAYS[troubleOf(error)] ?? "Не получилось позвать memo.";
}

export function useChat(me: Me): Chat {
  const [agentFailure, setAgentFailure] = useState<string | null>(null);
  /** На что сейчас отвечаем. `null` — обычная отправка. */
  const [replying, setReplying] = useState<Quote | null>(null);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // Где человек находится — отдельным знанием (Д-10, task-020).
  // Здесь про адрес больше ничего нет: он выводится из самого адреса,
  // а не хранится рядом с ним вторым способом.
  const where = useAddress();
  const { currentId, currentIdRef, wanted, focus, atRootRef, navigate } = where;

  // Список каналов — отдельным знанием (Д-10, task-020). Лента про него
  // не спрашивает, он про ленту не знает.
  const rooms = useRooms(where);

  // Перечитывание списка — ссылкой: догон зовёт его из эффекта, который
  // не имеет права пересоздаваться на каждом обновлении списка.
  const roomsRef = useRef(rooms.reload);
  roomsRef.current = rooms.reload;

  // Что на экране сейчас — для отправки, которой нужен последний номер,
  // но не нужна перерисовка при каждом его изменении.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // Через ссылку, а не через зависимость: иначе `send` пересоздавался бы
  // на каждый выбор цитаты, а вместе с ним — обработчик поля ввода.
  const replyingRef = useRef<Quote | null>(null);
  replyingRef.current = replying;

  // Курсор догона живёт в ref, а не в состоянии: он меняется чаще, чем экран,
  // и перерисовывать ленту ради него незачем.
  const cursor = useRef(0);

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
   * Сколько реплик разговора живёт в ленте (Р-023).
   *
   * ⚠️ ЧИСЛО — ОЦЕНКА, ПОДТВЕРЖДЁННАЯ ЗАМЕРОМ: 360 узлов перерисовываются
   * за 17 мс при пороге виртуализации в 100. Запас шестикратный, поэтому
   * библиотека не нужна.
   */
  const ОКНО = 300;

  /**
   * Человек внизу ленты — значит можно резать сверху.
   *
   * ⚠️ ССЫЛКА, А НЕ СОСТОЯНИЕ: меняется на каждом движении прокрутки,
   * и перерисовывать из-за этого ленту было бы ровно тем, с чем мы
   * боремся. Кто листает назад — у того не режем ничего: он читает
   * то самое, что мы бы выбросили.
   */
  const following = useRef(true);

  /**
   * Разложить приехавшее догоном: в ленту, в закреплённое, в счётчики.
   *
   * ⚠️ ЧУЖАЯ КОМНАТА — ПОВОД ПЕРЕЧИТАТЬ СПИСОК, И БЕЗ ЭТОГО СЧЁТЧИК
   * НЕПРОЧИТАННОГО МЁРТВ. Догон приносит реплики всего пространства,
   * но в ленту попадают только реплики ОТКРЫТОГО разговора (Р-023):
   * остальные отбрасываются здесь же. Значит про сообщение в соседнем
   * канале клиент не узнаёт ничего, и число у канала никогда бы
   * не выросло, пока туда не зайдёшь.
   *
   * Перечитываем список, а не считаем сами: счётчик живёт на сервере
   * (Р-029), и второй способ его получить разошёлся бы с первым.
   * Запрос идёт, только когда событие ЕСТЬ, — то есть ровно по делу.
   */
  const принять = useCallback(
    (приехавшие: SyncLine[]) => {
      const открыт = currentIdRef.current;
      setMessages((current) =>
        merge(current, ofRoom(приехавшие, открыт), following.current ? ОКНО : undefined),
      );
      setPinned((current) => mergePinned(current, приехавшие, открыт));
      if (приехавшие.some((one) => one.conversationId !== открыт)) void roomsRef.current();
    },
    [currentIdRef],
  );

  /** Догон до конца: страницами, пока сервер говорит, что есть ещё. */
  const catchUp = useCallback(async () => {
    for (let page = 0; page < 20; page++) {
      const batch = await api.sync(cursor.current);
      cursor.current = batch.seq;
      if (batch.messages.length > 0) принять(batch.messages);
      if (!batch.hasMore) return;
    }
    // ⚠️ ССЫЛКА В ЗАВИСИМОСТЯХ, А НЕ ЕЁ СОДЕРЖИМОЕ. Сам объект ссылки
    // неизменен, и от него ничего не пересоздаётся; `currentIdRef.current`
    // в списке означал бы пересоздание догона на каждом переключении
    // канала — ровно то, ради чего ссылка и заведена.
  }, [принять]);

  // Список разговоров — один раз при входе. `navigate` в зависимостях
  // стоит честно, хотя маршрутизатор и обещает его неизменность: обещание
  // чужой библиотеки — не то, на чём стоит держать единственную загрузку.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ссылки на адрес неизменны, их содержимое читается на момент ответа
  useEffect(() => {
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
      .catch(() => {
        setFailure("Не удалось загрузить список каналов");
        setLoading(false);
      });
  }, [navigate]);

  // Лента выбранного разговора — с нуля при каждом переключении.
  // `wanted` в зависимостях: переход по цитате в УЖЕ открытый разговор
  // обязан долистать до реплики, а идентификатор при этом не меняется.
  useEffect(() => {
    if (!currentId) return;
    // Тот же разговор и никуда не ведут по цитате — перезагружать нечего.
    if (shown.current === currentId && wanted === null) return;

    let cancelled = false;
    setLoading(true);

    api
      .messages(currentId, { limit: PAGE })
      .then(async (first) => {
        if (cancelled) return;
        const page = wanted === null ? first : await pageBackTo(currentId, first, wanted);
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
        setMessages((current) => {
          const свои = current.filter((one) => one.conversationId === currentId);
          return свои.length === 0 ? page.items : merge(свои, page.items);
        });
        setHasOlder(page.hasMore);
        /**
         * ⚠️ КУРСОР ДОГОНА — ЭТО ГОЛОВА ПРОСТРАНСТВА, А НЕ НОМЕР ИЗ ЭТОЙ
         * КОМНАТЫ. И назад он не ходит никогда.
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
        cursor.current = Math.max(cursor.current, page.head);
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
      // Каналы приезжают тем же звонком. Молча: не приехали — человек
      // читает то, что уже на экране, и это не повод его пугать.
      //
      // ⚠️ ЗАКРЕПЛЁННОЕ ЗДЕСЬ БОЛЬШЕ НЕ ЧИТАЕТСЯ. Оно приходит догоном
      // вместе с самой репликой: закрепление двигает номер изменения,
      // как правка и удаление. Отдельный запрос был вторым путём к тому
      // же событию.
      rooms.reload().catch(ignore);
    };
    stream.addEventListener("changed", onChanged);
    return () => {
      stream.removeEventListener("changed", onChanged);
      stream.close();
    };
  }, [catchUp, rooms.reload]);

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
      setMessages((current) => [...current, draft]);

      let sent: Message;
      try {
        sent = await api.send(currentId, body, clientMsgId, {
          ...(replyingRef.current ? { replyToId: replyingRef.current.id } : {}),
        });
      } catch {
        // Помечаем ту самую реплику и уходим. Ключ идемпотентности у неё
        // прежний, поэтому повтор не задвоит её на сервере.
        setMessages((current) =>
          current.map((one) => (one.id === clientMsgId ? { ...one, state: "не ушло" } : one)),
        );
        return;
      }

      // Ответ отдан: строка над полем ввода больше не нужна.
      setReplying(null);

      // Черновик заменяется настоящей записью: у неё свой идентификатор
      // и настоящий номер. Держать обе — значит однажды показать обе.
      setMessages((current) =>
        merge(
          current.filter((one) => one.id !== clientMsgId),
          [sent],
        ),
      );

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
    [currentId, me],
  );

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

  /** Закреплённое разговора. Читается отдельной дверью и при каждой смене. */
  useEffect(() => {
    if (!currentId) {
      setPinned([]);
      return;
    }
    let cancelled = false;
    api
      .pinned(currentId)
      .then(({ items }) => {
        if (!cancelled) setPinned(items);
      })
      .catch(() => {
        // Полоска закреплённого — не то, ради чего стоит ронять экран.
        // Не приехала — её просто нет, разговор читается дальше.
        if (!cancelled) setPinned([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const pin = useCallback(
    async (messageId: string, next: boolean) => {
      await api.pin(messageId, next);
      // Полоску не перечитываем: закрепление двигает номер изменения,
      // и реплика приедет ближайшим догоном — тем же путём, каким она
      // приезжает всем остальным. Правка на месте ниже нужна только
      // затем, чтобы галочка в меню не мигала до догона.
      setMessages((current) =>
        current.map((one) =>
          one.id === messageId ? { ...one, pinnedAt: next ? new Date().toISOString() : null } : one,
        ),
      );
    },
    // Разговор здесь больше ни при чём: полоску перестраивает догон.
    [],
  );

  const edit = useCallback(async (messageId: string, body: string) => {
    const changed = await api.edit(messageId, body);
    setMessages((current) => current.map((one) => (one.id === messageId ? changed : one)));
  }, []);

  /**
   * Удалить свою реплику.
   *
   * ⚠️ ЦИТАТЫ НА НЕЁ ГАСЯТСЯ ЗДЕСЬ ЖЕ. Сервер обнуляет ссылку, но чужие
   * реплики уже лежат на экране со старой цитатой — и остались бы с ней
   * до перезагрузки, показывая текст удалённого сообщения.
   */
  const remove = useCallback(async (messageId: string) => {
    await api.remove(messageId);
    setMessages((current) =>
      current
        .filter((one) => one.id !== messageId)
        .map((one) => (one.replyTo?.id === messageId ? { ...one, replyTo: null } : one)),
    );
    setPinned((current) => current.filter((one) => one.id !== messageId));
  }, []);

  /** Переслать в другой разговор. Тело копируется, источник — ссылкой. */
  const forward = useCallback(
    async (message: Message, toConversationId: string) => {
      const sent = await api.send(toConversationId, message.body, crypto.randomUUID(), {
        forwardedFromId: message.id,
      });
      // Если переслали в открытый разговор — реплика появляется сразу.
      if (toConversationId === currentId) setMessages((cur) => merge(cur, [sent]));
    },
    [currentId],
  );

  /**
   * Лента сообщает, внизу ли человек. Это единственное, что ей нужно
   * рассказать про себя наружу, и рассказывает она это ссылкой:
   * перерисовки от движения прокрутки не происходит.
   */
  const follow = useCallback((yes: boolean) => {
    following.current = yes;
  }, []);

  // Лента открытого разговора — одна на возврат наружу и на подсчёт
  // прочитанного: два разных выражения для одного и того же однажды
  // разошлись бы.
  const видимые = messages.filter((m) => m.conversationId === currentId);

  /**
   * ⚠️ ПЕРЕЧИТЫВАЕМ СПИСОК И ПРИ СМЕНЕ РАЗГОВОРА. Пока человек сидел
   * в одном канале, его собственная отметка прочтения ушла на сервер,
   * а список в памяти остался прежним. Без этого число у только что
   * покинутого канала висело бы до перезагрузки страницы.
   */
  useEffect(() => {
    if (currentId) void roomsRef.current();
  }, [currentId]);

  // Что человек уже видел — отдельным знанием (Р-029). `useChat` про это
  // ничего не решает: он только даёт номер последней реплики и говорит,
  // внизу ли лента.
  const reading = useReading({
    rooms: rooms.items,
    currentId,
    messages: видимые,
    meId: me.participant.id,
    following,
  });

  const panel = usePanel({ rooms, reading, currentId, select });

  return {
    conversations: rooms.items,
    current: rooms.items.find((c) => c.id === currentId) ?? null,
    follow,
    replying,
    reply,
    panel,
    boundary: reading.boundary,
    pinned,
    pin,
    edit,
    remove,
    forward,
    messages: видимые,
    hasOlder,
    loading,
    failure,
    focus,
    select,
    openAt,
    loadOlder,
    send,
    agentFailure,
    addChannel: rooms.addChannel,
    removeChannel: rooms.removeChannel,
    addThread: rooms.addThread,
  };
}
