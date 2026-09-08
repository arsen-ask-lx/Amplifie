import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";
import { troubleOf } from "../shared/trouble.js";
import {
  api,
  type Conversation,
  isTombstone,
  type Me,
  type Message,
  type Quote,
  type SyncLine,
} from "./api.js";

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
 * Своя реплика, ещё не дошедшая до сервера.
 *
 * ⚠️ ПОЛЕ ЖИВЁТ ТОЛЬКО ЗДЕСЬ И НЕ ПРИХОДИТ С СЕРВЕРА. `Message` повторяет
 * форму ответа сервера, и дописывать в неё наши выдумки нельзя: однажды
 * кто-то решит, что состояние доставки хранится в базе. Поэтому отдельный
 * тип, а не лишнее поле в общем.
 */
export type Local = Message & { state?: "идёт" | "не ушло" };

/**
 * Слияние по идентификатору: догон отвечает «вот как теперь», а не «вот
 * что дописали».
 *
 * ⚠️ ДОГОН МОЖЕТ ПРИНЕСТИ РЕПЛИКУ, КОТОРАЯ УЖЕ ЕСТЬ. Так и должно быть:
 * правка старой реплики приезжает ею же самой. Поэтому известный
 * идентификатор ЗАМЕЩАЕТСЯ, а не добавляется, — иначе исправленная
 * реплика встала бы в ленту второй раз.
 *
 * ⚠️ МЕСТО В ЛЕНТЕ БЕРЁТСЯ ИЗ `seq`, А НЕ ИЗ ПОРЯДКА ОТВЕТА. Сервер
 * упорядочивает догон по номеру ИЗМЕНЕНИЯ, и исправленная позавчерашняя
 * реплика приезжает последней. Место в разговоре у неё при этом прежнее.
 *
 * ⚠️ НАДГРОБИЕ УБИРАЕТ РЕПЛИКУ, А НЕ ДОБАВЛЯЕТ ПУСТУЮ. Текста в нём нет,
 * и показывать нечего: удалённое исчезает с экрана у всех, а не только
 * у того, кто удалил.
 */
export function merge(current: Message[], incoming: SyncLine[]): Message[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const line of incoming) {
    if (isTombstone(line)) byId.delete(line.id);
    else byId.set(line.id, line);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Полоска закреплённого после догона.
 *
 * ⚠️ ПЕРЕСТРАИВАЕТСЯ ИЗ ТОГО ЖЕ ОТВЕТА, ЧТО И ЛЕНТА. Раньше закрепление
 * приезжало ОТДЕЛЬНЫМ запросом по звонку — второй путь к тому же событию.
 * Два пути к одному событию расходятся молча: у нас это уже случалось.
 *
 * Первая загрузка полоски всё равно остаётся отдельной дверью, и это не
 * противоречие: закреплённая реплика может лежать на тысячу строк выше
 * загруженного окна, и догон о ней ничего не скажет — он рассказывает
 * про ИЗМЕНЕНИЯ, а не про историю.
 *
 * Порядок — свежие сверху, по времени закрепления: тот же, что у сервера.
 */
export function mergePinned(
  current: Message[],
  incoming: SyncLine[],
  roomId: string | null,
): Message[] {
  if (!roomId || incoming.length === 0) return current;

  const mine = incoming.filter((line) => line.conversationId === roomId);
  if (mine.length === 0) return current;

  const byId = new Map(current.map((m) => [m.id, m]));
  const before = byId.size;
  let added = 0;

  for (const line of mine) {
    // Закреплённой реплика остаётся, только пока жива и пока отметка стоит.
    // Оба «нет» ведут в одно и то же место, и хорошо, что в одно.
    if (isTombstone(line) || line.pinnedAt === null) byId.delete(line.id);
    else {
      byId.set(line.id, line);
      added += 1;
    }
  }

  // Полоска не изменилась — отдаём ТУ ЖЕ ссылку, а не новый список:
  // иначе каждая перерисовка ленты перерисовывала бы и её.
  if (byId.size === before && added === 0) return current;
  return [...byId.values()].sort(byPinnedAtDesc);
}

/** Свежее закрепление сверху — тот же порядок, что отдаёт сервер. */
function byPinnedAtDesc(a: Message, b: Message): number {
  return (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "");
}

const maxSeq = (messages: Message[]) => messages.reduce((top, m) => Math.max(top, m.seq), 0);

/**
 * Куда смотреть в ленте. Каждый переход рождает НОВЫЙ объект, даже если
 * поля те же: по его смене лента понимает, что надо подсветить реплику
 * ещё раз. Сравнение по значению здесь молча съело бы повторный переход.
 *
 * Новизну теперь даёт сам маршрутизатор: у каждого перехода свой `key`,
 * даже если адрес тот же. Раньше её приходилось изображать вручную.
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
  messages: Local[];
  hasOlder: boolean;
  loading: boolean;
  failure: string | null;
  focus: Focus | null;
  select: (id: string) => void;
  /** Открыть разговор на конкретной реплике — переход по цитате. */
  openAt: (conversationId: string, seq: number) => void;
  loadOlder: () => Promise<void>;
  send: (body: string, clientMsgId: string) => Promise<void>;
  /** Почему агент не ответил. Показывается один раз и не как его реплика. */
  agentFailure: string | null;
  /** На что отвечаем прямо сейчас. Строка над полем ввода. */
  replying: Quote | null;
  reply: (message: Message | null) => void;
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
  "нет-модели": "Сводка не отвечает: не подключена ни одна нейросеть.",
  "мост-молчит": "Сводка взяла вопрос и не ответила вовремя.",
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
  return SAYS[troubleOf(error)] ?? "Не получилось позвать Сводку.";
}

export function useChat(me: Me): Chat {
  const [agentFailure, setAgentFailure] = useState<string | null>(null);
  /** На что сейчас отвечаем. `null` — обычная отправка. */
  const [replying, setReplying] = useState<Quote | null>(null);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // Где человек находится — читается из адреса, а не хранится рядом с ним.
  //
  // `useMatch`, а не `useParams`: параметры адреса нужны ЗДЕСЬ, в хуке,
  // который зовётся выше любого `<Route>`. `useParams` в таком месте
  // молча вернул бы пустоту — и разговор не открывался бы вовсе.
  const atSeq = useMatch("/c/:conversationId/:seq");
  const atRoom = useMatch("/c/:conversationId");
  const location = useLocation();
  const navigate = useNavigate();

  const currentId = atSeq?.params.conversationId ?? atRoom?.params.conversationId ?? null;
  const wanted = atSeq?.params.seq === undefined ? null : Number(atSeq.params.seq);

  // Список разговоров читается один раз при входе, и внутри того эффекта
  // нужно знать, назвал ли адрес разговор. Через ссылку, а не через
  // зависимость: иначе эффект перезапускался бы на каждом переходе
  // и перечитывал список без повода.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  /** Мы на голом «/» — только там уместно подставить разговор по умолчанию. */
  const atRootRef = useRef(location.pathname === "/");
  atRootRef.current = location.pathname === "/";

  // Ключ перехода в зависимостях НАМЕРЕННО «лишний»: повторный переход
  // к ТОЙ ЖЕ реплике обязан подсветить её ещё раз, а по значению он
  // неотличим от предыдущего и был бы съеден молча.
  // biome-ignore lint/correctness/useExhaustiveDependencies: новизна перехода и есть смысл
  const focus = useMemo<Focus | null>(
    () => (currentId && wanted !== null ? { conversationId: currentId, seq: wanted } : null),
    [currentId, wanted, location.key],
  );

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

  /** Догон до конца: страницами, пока сервер говорит, что есть ещё. */
  const catchUp = useCallback(async () => {
    for (let page = 0; page < 20; page++) {
      const batch = await api.sync(cursor.current);
      cursor.current = batch.seq;
      if (batch.messages.length > 0) {
        setMessages((current) => merge(current, batch.messages));
        setPinned((current) => mergePinned(current, batch.messages, currentIdRef.current));
      }
      if (!batch.hasMore) return;
    }
  }, []);

  /**
   * Перечитать список разговоров.
   *
   * ⚠️ ЗОВЁТСЯ НЕ ТОЛЬКО ПРИ ВХОДЕ. Раньше список читался ровно один раз,
   * и заведённый кем-то канал не появлялся у остальных до перезагрузки
   * страницы — владелец это и поймал. Догон `/v1/sync` тут не помощник:
   * он умеет только «сообщения новее номера N», а канал не сообщение.
   * Зато звонок о переменах приходит на каждое событие — по нему и
   * перечитываем: запрос дешёвый, а список короткий.
   */
  const reloadRooms = useCallback(async () => {
    const { items } = await api.conversations();
    setConversations(items);
    return items;
  }, []);

  // Список разговоров — один раз при входе. `navigate` в зависимостях
  // стоит честно, хотя маршрутизатор и обещает его неизменность: обещание
  // чужой библиотеки — не то, на чём стоит держать единственную загрузку.
  useEffect(() => {
    api
      .conversations()
      .then(({ items }) => {
        setConversations(items);
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
         * ⚠️ НЕ ПРОСТО `setMessages(page.items)`, И ВОТ ПОЧЕМУ.
         *
         * В только что заведённом канале человек успевает отправить
         * первое сообщение РАНЬШЕ, чем долетит ответ на загрузку ленты.
         * Ответ приходит пустым — канал в момент запроса был пуст, — и
         * прямая подстановка стирала уже показанную реплику. Через
         * мгновение её возвращал догон: на экране это выглядело как
         * мигание, и только у первого сообщения и только в новом канале.
         * Владелец поймал это глазами; из кода не видно вовсе.
         *
         * Поэтому свои неотправленные реплики переносятся в новую ленту.
         * Их видно по метке состояния: она есть только у того, что ещё
         * не подтверждено сервером.
         */
        setMessages((current) => {
          const своё = current.filter(
            (one) => one.conversationId === currentId && (one as Local).state !== undefined,
          );
          return своё.length === 0 ? page.items : merge(page.items, своё);
        });
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
      // Каналы приезжают тем же звонком. Молча: не приехали — человек
      // читает то, что уже на экране, и это не повод его пугать.
      //
      // ⚠️ ЗАКРЕПЛЁННОЕ ЗДЕСЬ БОЛЬШЕ НЕ ЧИТАЕТСЯ. Оно приходит догоном
      // вместе с самой репликой: закрепление двигает номер изменения,
      // как правка и удаление. Отдельный запрос был вторым путём к тому
      // же событию.
      reloadRooms().catch(ignore);
    };
    stream.addEventListener("changed", onChanged);
    return () => {
      stream.removeEventListener("changed", onChanged);
      stream.close();
    };
  }, [catchUp, reloadRooms]);

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
        id: clientMsgId,
        conversationId: currentId,
        body,
        kind: "human",
        seq: maxSeq(messagesRef.current) + 0.5,
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
          await api.ask(currentId);
        } catch (error) {
          setAgentFailure(agentTrouble(error));
        }
      })();
    },
    [currentId, me],
  );

  /**
   * Новый разговор появляется в списке и сразу открывается.
   *
   * Список перечитывается целиком, а не дополняется ответом: в нём мог
   * появиться и чужой канал, пока мы набирали название. Один запрос
   * дешевле, чем два источника правды о списке.
   */
  const openNew = useCallback(
    async (make: () => Promise<Conversation>) => {
      const created = await make();
      const { items } = await api.conversations();
      setConversations(items);
      navigate(`/c/${created.id}`);
    },
    [navigate],
  );

  const addChannel = useCallback(
    async (title: string) => {
      await openNew(() => api.createChannel(title));
    },
    [openNew],
  );

  /**
   * Удалить канал.
   *
   * ⚠️ СПИСОК ПЕРЕЧИТЫВАЕТСЯ, А НЕ ПРАВИТСЯ НА МЕСТЕ. Из списка уходит
   * не только сам канал, но и всё, что от него зависело: порядок по
   * свежести, ветки. Сервер уже умеет собрать этот список правильно —
   * второе такое же место на клиенте разошлось бы с ним.
   *
   * ⚠️ ЕСЛИ УДАЛИЛИ ТОТ, ЧТО ОТКРЫТ, — уводим на первый оставшийся.
   * Остаться на адресе снесённого канала значит показать «Загружаем…»
   * навсегда: сервер о нём больше не расскажет.
   */
  const removeChannel = useCallback(
    async (id: string) => {
      await api.removeChannel(id);
      const items = await reloadRooms();
      if (currentIdRef.current !== id) return;
      const next = items.find((room) => room.parentId === null);
      navigate(next ? `/c/${next.id}` : "/", { replace: true });
    },
    [reloadRooms, navigate],
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

  return {
    conversations,
    current: conversations.find((c) => c.id === currentId) ?? null,
    replying,
    reply,
    pinned,
    pin,
    edit,
    remove,
    forward,
    messages: messages.filter((m) => m.conversationId === currentId),
    hasOlder,
    loading,
    failure,
    focus,
    select,
    openAt,
    loadOlder,
    send,
    agentFailure,
    addChannel,
    removeChannel,
    addThread,
  };
}
