import { z } from "zod";
import { KEY_SHAPES, type KeyProvider, keyShapeMessage } from "./keys.js";
import { PROJECT_COLOR, PROJECT_ICONS } from "./projectLook.js";

/**
 * Контракт дверей чата: что сервер принимает и что отдаёт (Р-034).
 *
 * Одна схема на форму. Сервер проверяет по ней вход и выход
 * (`@fastify/type-provider-zod`), фронт берёт из неё типы (`z.infer`).
 * Прежде эти формы были написаны дважды руками — на беке и на фронте.
 *
 * Отдельная точка входа, а не `index`: фронту нужны только типы, и zod
 * не должен ехать в его сборку.
 *
 * Время — строкой ISO: так оно едет по JSON, и так его читает фронт.
 */

const id = z.uuid();
const when = z.string();

/**
 * Текст, пришедший от человека. Нулевой символ Postgres не хранит: запрос
 * падал с 500 и — до task-120 — отдавал наружу текст SQL с параметрами.
 * Запрет стоит в схеме, а не в хуке: так его видит описание API, и
 * Schemathesis не считает отказ «отвергнутым верным запросом».
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: нулевой символ здесь не случайный — его и запрещаем.
const NO_NUL = /^[^\u0000]*$/u;
const text = () => z.string().regex(NO_NUL, "в тексте недопустим нулевой символ");

/* ── ответы ────────────────────────────────────────────────────────── */

/** Проект — папка чатов и область чтения агента (Р-032). */
export const projectView = z.object({
  id,
  title: z.string(),
  /** Вид папки (task-038). `null` — вид по умолчанию. */
  icon: z.string().nullable(),
  color: z.string().nullable(),
  /** Закреплён ли ЭТИМ человеком. Личное: у коллеги своё. */
  pinned: z.boolean(),
});

/** Строка панели: разговор со счётчиками. */
export const conversationView = z.object({
  id,
  kind: z.string(),
  title: z.string(),
  parentId: id.nullable(),
  /** `null` — вне проектов, и это законно (Р-033). */
  projectId: id.nullable(),
  /** Когда тут в последний раз говорили. По нему сервер и сортирует. */
  lastAt: when,
  /** Сколько ЧУЖИХ реплик человек не видел (Р-029). Считает сервер. */
  unread: z.number(),
  /** Сколько раз позвали ИМЕННО ЕГО и он не видел (Р-031). */
  mentions: z.number(),
  /** Докуда дочитал — отвечает на «откуда черта», а `unread` — на «сколько». */
  readSeq: z.number(),
  pinned: z.boolean(),
  /** Убирает ли здесь чужое — владелец канала или пространства (Р-035). */
  moderator: z.boolean(),
});

/**
 * Первые сто видимых разговоров в порядке панели — `/v1/conversations`.
 * Интерфейс этим больше не пользуется: панель берёт `panelSnapshot`
 * и курсорные двери (task-064), окно пересылки — поиск чата (task-117).
 * Зовут тесты и оснастка; предел закрыл Д-15.
 */
export const panelView = z.object({
  items: z.array(conversationView),
  projects: z.array(projectView),
});

/**
 * Сводный ответ панели (Р-037): проекты со счётчиками, первая порция
 * «Недавних» и строка открытого чата. Чаты проектов приезжают отдельно,
 * когда проект раскрыли.
 */
export const panelSnapshot = z.object({
  projects: z.array(
    projectView.extend({
      /** Сумма непрочитанного по ВИДИМЫМ чатам папки. */
      unread: z.number(),
      mentions: z.number(),
    }),
  ),
  recent: z.object({
    items: z.array(conversationView),
    next: z.string().nullable(),
  }),
  open: conversationView.nullable(),
});

/** Порция строк панели. `next` непрозрачен для клиента. */
export const conversationsPage = z.object({
  items: z.array(conversationView),
  next: z.string().nullable(),
});

/** На что отвечает реплика. Кусок текста режет сервер. */
export const quoteView = z.object({
  id,
  seq: z.number(),
  author: z.string(),
  excerpt: z.string(),
});

export const messageView = z.object({
  id,
  /** Ключ, выданный клиентом при наборе: связывает черновик с записанным. */
  clientMsgId: id,
  conversationId: id,
  body: z.string(),
  kind: z.string(),
  seq: z.number(),
  createdAt: when,
  editedAt: when.nullable(),
  pinnedAt: when.nullable(),
  author: z.object({ id, name: z.string(), kind: z.string() }),
  /** `null` — ответа нет ЛИБО исходную реплику удалили: снаружи одно и то же. */
  replyTo: quoteView.nullable(),
  /** Имя того, от кого переслано. `null` — не пересылка. */
  forwardedFrom: z.string().nullable(),
});

/** Надгробие: реплику удалили. Текста нет — сервер его не отдаёт вовсе. */
export const tombstoneView = z.object({
  id,
  conversationId: id,
  seq: z.number(),
  deleted: z.literal(true),
});

export const syncView = z.object({
  messages: z.array(z.union([tombstoneView, messageView])),
  /** Куда двигать курсор. */
  seq: z.number(),
  /** Есть ещё — идти за следующей страницей сразу. */
  hasMore: z.boolean(),
});

/**
 * Сообщение потока живых обновлений (Р-006, task-085).
 *
 * ⚠️ `line` — ТОТ ЖЕ ВИД, ЧТО У ДОГОНА, и это главное здесь.
 * Событие и догон — два способа доехать по ОДНОЙ дороге, а не две
 * дороги. Объяви здесь свою форму — они разошлись бы на первой правке.
 *
 * Поля нет вовсе — изменение, которое сервер не умеет описать точно
 * (правка, удаление, закрепление, заводка разговора): за ним идут догоном.
 */
export const changeEvent = z.object({
  /** Где изменилось; `null` — изменилось пространство. */
  conversation: id.nullable(),
  line: messageView.optional(),
  /**
   * Кого позвали этой репликой (task-092).
   *
   * ⚠️ В СОБЫТИИ, А НЕ В РЕПЛИКЕ. Вид сообщения — общий контракт, он ездит
   * в ленту, догон и закреплённое; распухать ему ради панели незачем.
   *
   * ⚠️ И ЭТО НЕ РОСКОШЬ. Клиент считает зовы сам с task-092, а посчитать
   * их по тексту не может: упоминание живёт в теле (Р-020), и разбор
   * на клиенте был бы второй разметкой рядом с серверной. Сервер этот
   * список уже посчитал при записи — второго запроса к базе не возникает.
   *
   * Утечки нет: событие уходит только тем, кто видит разговор, а кто в нём
   * состоит, им и так отвечает `/v1/conversations/:id/people` (Р-031).
   */
  mentions: z.array(id).optional(),
  /**
   * Папка разговора с репликой (task-119, Д-65): свёрнутая папка, чьих
   * чатов вкладка не загружала, считает новое сама, без запроса. Папка —
   * `projectId` самого разговора, как у серверного счёта папки
   * (`projectCountsFor`), а не его корня. Нет поля — чат вне папок.
   */
  project: id.optional(),
});

export const messagesPage = z.object({
  items: z.array(messageView),
  hasMore: z.boolean(),
  /** Голова пространства — начальный курсор догона (Д-19). */
  head: z.number(),
  /**
   * Докуда человек дочитал этот чат (task-107). Приходит с окном, открытым
   * «на непрочитанном»: черту рисует лента, а не строка панели — у чата вне
   * первой порции панели строки может ещё не быть (Д-51).
   */
  readSeq: z.number().optional(),
  /** Есть ли за верхним краем окна более новые реплики (task-099, task-107). */
  hasNewer: z.boolean().optional(),
});

export const pinnedList = z.object({ items: z.array(messageView) });

/**
 * Найденное поиском (task-100): тот же вид реплики, что в ленте, плюс
 * название чата — выдача идёт по всем разговорам сразу. Своей формы
 * реплики у поиска нет: разойдись она с лентой — найденное выглядело бы
 * не так, как то же сообщение в чате.
 */
export const searchHit = messageView.extend({ conversationTitle: z.string() });

/**
 * Страница поиска. `next` — курсор следующей страницы; `null` — дальше нет.
 *
 * ⚠️ `total` ТОЛЬКО ДЛЯ ПОИСКА В ОДНОМ ЧАТЕ (task-106): его показывает
 * счётчик «3 из 17» в полосе поиска. У общего окна счётчика нет, и лишний
 * запрос к базе там не делается. Потолок — `SEARCH_TOTAL_CAP`: считать все
 * попадания частого слова значит прочитать их все.
 */
export const searchPage = z.object({
  items: z.array(searchHit),
  next: z.number().nullable(),
  total: z.number().optional(),
});

/** Кого можно позвать (Р-031). */
export const personView = z.object({ id, name: z.string(), kind: z.string() });
export const peopleList = z.object({ items: z.array(personView) });

/** Самый ранний неувиденный зов. `null` — идти некуда. */
export const mentionAt = z.object({ seq: z.number().nullable() });

/** Остаток непрочитанного после отметки: клиент видит только окно ленты. */
export const readResult = z.object({ unread: z.number() });

export const createdConversation = z.object({
  id,
  kind: z.string(),
  title: z.string(),
  parentId: id.nullable(),
  projectId: id.nullable(),
});

export const createdThread = z.object({
  id,
  kind: z.string(),
  title: z.string(),
  parentId: id,
});

export const idOnly = z.object({ id });
export const movedConversation = z.object({ id, projectId: id.nullable() });

/* ── запросы ───────────────────────────────────────────────────────── */

export const idParams = z.object({ id });

const body = text().trim().min(1, "сообщение пустое").max(8000, "сообщение длиннее 8000 символов");

export const sendBody = z.object({
  body,
  clientMsgId: z.uuid("нужен идентификатор, сгенерированный клиентом"),
  /** На что отвечаем. Видимость проверяет ядро, а не схема. */
  replyToId: id.optional(),
  /** Откуда переслано. Та же проверка тем же местом. */
  forwardedFromId: id.optional(),
});

export const editBody = z.object({ body });

/**
 * Поиск по сообщениям (task-100). Текст — в теле, а не в адресе: адрес пишется
 * в журналы сервера и прокси, а текст поиска — это переписка людей.
 */
export const searchBody = z.object({
  q: text().max(200, "запрос длиннее 200 символов"),
  before: z.int().positive().optional(),
  limit: z.int().min(1).max(50).optional(),
  /**
   * Искать только в этом чате (task-106). Нет поля — поиск по всем видимым,
   * как у окна Ctrl+K. Права те же: номер чата без доступа даёт пустую выдачу.
   */
  conversationId: id.optional(),
});

/**
 * Поиск чата по названию — окно «Переслать» (task-117). Текст в теле, как у
 * `searchBody`: названия приватных чатов — тоже переписка людей.
 */
export const chatSearchBody = z.object({
  q: text().trim().min(1, "пустой запрос").max(100, "запрос длиннее 100 символов"),
  limit: z.int().min(1).max(50).optional(),
});

/** Найденные чаты: только корневые и только видимые. */
export const chatsFound = z.object({ items: z.array(conversationView) });

export const readBody = z.object({ seq: z.int().min(0, "номер не бывает отрицательным") });

export const channelBody = z.object({
  title: text().trim().min(1, "у канала нужно название").max(120),
  /** Завести сразу внутри проекта (task-035). */
  projectId: id.optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
});

export const threadBody = z.object({
  title: text().trim().min(1, "у ветки нужно название").max(200),
});

/**
 * Проект: имя и вид. `null` — «убрать вид», отсутствие поля — «не трогать»:
 * слить их значило бы стирать цвет при каждом переименовании.
 */
export const projectBody = z.object({
  title: text().trim().min(1, "у проекта нужно название").max(120),
  icon: z.enum(PROJECT_ICONS).nullable().optional(),
  /**
   * Цвет — значение, а не имя из набора (task-104, отмена Р-041): человек
   * выбирает его пипеткой. Запись одна — `#rrggbb` строчными, иначе один
   * цвет лежал бы в базе несколькими разными строками.
   */
  color: z
    .string()
    .regex(PROJECT_COLOR, "цвет записывается как #rrggbb строчными буквами")
    .nullable()
    .optional(),
});
export const projectPatchBody = projectBody.partial();

/** `null` — снять принадлежность; `nullable`, а не `optional`: это разные вещи. */
export const moveBody = z.object({ projectId: id.nullable() });

/** Насколько широко агент читает, отвечая (Р-032). По умолчанию — этот разговор. */
export const askBody = z.object({ scope: z.enum(["conversation", "project"]).optional() });

/**
 * Страница и курсор — строками, как пришли в адресе. Мусор в них значит
 * «по умолчанию», а не ошибку: сломанная ссылка не должна ронять экран.
 */
/**
 * Страница ленты: назад от `before` либо вперёд от `after` (task-099).
 * Оба разом — отказ: выбрать один молча значит отдать не ту страницу.
 */
export const pageQuery = z
  .object({
    limit: text().optional(),
    before: text().optional(),
    after: text().optional(),
    /**
     * Куда открыть ленту (task-107). `unread` — окно вокруг первой
     * непрочитанной реплики; нет непрочитанного — последняя страница,
     * как и раньше. Считает сервер: иначе открытие чата стоило бы лишнего
     * круга «спроси отметку, потом ленту», а правило жило бы дважды.
     */
    around: z.literal("unread").optional(),
  })
  .refine((query) => query.before === undefined || query.after === undefined, {
    message: "страница ленты идёт либо назад (before), либо вперёд (after)",
  })
  .refine((query) => query.around === undefined || (!query.before && !query.after), {
    message: "«вокруг непрочитанного» не сочетается с курсором страницы",
  });
export const cursorQuery = z.object({ cursor: text().optional() });
export const limitQuery = z.object({ limit: text().optional() });

/** Какой чат открыт в этой вкладке: его строка нужна ленте. */
export const openQuery = z.object({ open: id.optional() });
export const syncQuery = z.object({
  after: text().optional(),
  limit: text().optional(),
});

/* ── вход, приглашения, агенты, мосты (task-120) ──────────────────── */

/**
 * Пустой ответ (204). Тела нет, и описание API говорит это прямо — иначе
 * Schemathesis не отличит «ничего не должно быть» от «забыли описать».
 */
export const noContent = z.null().optional();

/**
 * Отказ: слово причины и, где можно, пояснение. Открытый объект: у отказа
 * проверки есть ещё `fields`, у порога частоты — `statusCode`.
 */
export const failure = z.looseObject({ error: z.string(), detail: z.string().optional() });

/** Что за дверью до входа: можно ли здесь завести компанию (task-023). */
export const entryView = z.object({ registrationOpen: z.boolean() });

/** Кто я: учётка, участник в пространстве и само пространство. */
export const meView = z.object({
  account: z.object({ id, email: z.string() }),
  participant: z.object({ id, displayName: z.string(), kind: z.string(), role: z.string() }),
  workspace: z.object({ id, name: z.string() }),
});

/**
 * Адрес почты. Правило zod по умолчанию пропускало дефис на краю части домена
 * и адрес в 300 знаков — Schemathesis (task-120) нашёл, что описание обещает
 * формат `email`, а дверь принимает то, что ему не отвечает. Части домена —
 * по RFC 1035, длина — не больше 254 (RFC 5321).
 */
const EMAIL =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const email = z
  .email({ pattern: EMAIL, error: "нужен корректный адрес почты" })
  .max(254, "адрес почты длиннее 254 символов");

export const registerBody = z.object({
  email,
  password: text().min(12, "пароль короче 12 символов"),
  displayName: text().trim().min(1, "как вас зовут?").max(80),
  workspaceName: text().trim().min(1, "название пространства пустое").max(120),
});

/**
 * Вход по приглашению — ОТДЕЛЬНАЯ схема (Р-009): у регистрации поля `token`
 * нет, и zod лишнее отбрасывает. Тот же токен через другой поток входа
 * обходил проверку доступа — ради этого разделение и сделано.
 */
export const joinBody = z.object({
  token: text().min(1),
  email,
  password: text().min(12, "пароль короче 12 символов"),
  displayName: text().trim().min(1, "как вас зовут?").max(80),
});

/**
 * Вход. Длина единица, а не двенадцать: у входа нет правил к паролю, он
 * проверяется совпадением, и подсказывать подбирающему нечего. Слова свои:
 * умолчание проверялки отвечало человеку по-английски.
 */
export const loginBody = z.object({
  email: text().min(1, "введите почту"),
  password: text().min(1, "введите пароль"),
});

/** Ссылка для команды. Верхнюю границу держит ещё и CHECK в базе. */
export const inviteBody = z.object({ maxUses: z.number().int().min(1).max(500).optional() });

/** Приглашение: токен виден ОДИН раз, здесь. В базе только его хеш. */
export const inviteCreated = z.object({
  id,
  token: z.string(),
  expiresAt: when,
  maxUses: z.number(),
  used: z.number(),
});

/** Раздел «Агенты»: кто есть и чем будет оплачен вызов прямо сейчас. */
export const agentsView = z.object({
  items: z.array(z.object({ id, name: z.string(), kind: z.string(), answersOn: z.string() })),
  /** Мост СПРАШИВАЮЩЕГО: агент отвечает через его подписку, не через чужую. */
  bridge: z.object({ connected: z.boolean(), online: z.boolean(), name: z.string().nullable() }),
  answersVia: z.object({ kind: z.string(), hint: z.string().nullable() }),
});

/**
 * Ключ поставщика: форма зависит от поставщика, поэтому схема — по одной на
 * каждого (`KEY_SHAPES`). Без `.trim()`: пробел внутри ключа — это другой
 * ключ, и молча его менять нельзя. Лишние пробелы по краям снимает клиент.
 */
const keyOf = (provider: KeyProvider) =>
  z.object({
    provider: z.literal(provider),
    key: text()
      .min(KEY_SHAPES[provider].least, keyShapeMessage(provider))
      .max(400, "это не похоже на ключ")
      .startsWith(KEY_SHAPES[provider].prefix, keyShapeMessage(provider)),
    scope: z.enum(["участник", "пространство"]).default("участник"),
  });
export const keyBody = z.discriminatedUnion("provider", [keyOf("anthropic"), keyOf("openai")]);

/** Ключ поставщика. Самого ключа здесь нет и не будет — только подсказка. */
export const modelKeyView = z.object({
  id,
  provider: z.string(),
  hint: z.string(),
  scope: z.enum(["участник", "пространство"]),
  createdAt: when,
});
export const modelKeyList = z.object({ items: z.array(modelKeyView) });

/** Код подключения моста и готовая строка запуска. Код виден один раз. */
export const bridgeIssued = z.object({
  id,
  code: z.string(),
  command: z.string(),
  expiresAt: when,
});

/** Мост — машина участника, на которой живёт его подписка (task-001). */
export const bridgeView = z.object({
  id,
  name: z.string().nullable(),
  /** Код погашен, машина подключалась хотя бы раз. */
  joined: z.boolean(),
  /** Приходил за работой недавно — значит спросить можно прямо сейчас. */
  online: z.boolean(),
  lastSeenAt: when.nullable(),
  createdAt: when,
});
export const bridgeList = z.object({ items: z.array(bridgeView) });

/**
 * Вопрос живой проверки. Без схемы `prompt` числом ронял дверь в 500 на
 * `.trim()` (найдено при разборе task-120).
 */
export const modelCheckBody = z.object({ prompt: text().max(2000).optional() });

/**
 * Машина моста (task-120): код подключения меняется на удостоверение. Прежде
 * тела проверялись руками (`400 bad_request`), и `code` числом ронял дверь
 * в 500 на `.trim()`. Мост на 400 и 422 отвечает одинаково — «не удалось».
 */
export const bridgeJoinBody = z.object({
  code: text().trim().min(1, "нет кода подключения"),
  name: text().trim().min(1, "у машины нет имени"),
});
export const bridgeJoined = z.object({ id, token: z.string() });

/** Имя архива моста в адресе скачивания. */
export const bridgeFileParams = z.object({ file: text().min(1) });

/**
 * Сам архив — байты gzip. Сериализатор их не трогает (буфер уходит как есть),
 * а описанию API тип говорит правду: двоичная строка.
 */
export const bridgeArchiveBytes = z
  .custom<Uint8Array>((value) => value instanceof Uint8Array)
  // Тип содержимого — только у этого ответа: отказ 404 той же двери — JSON.
  .meta({ content: { "application/gzip": { schema: { type: "string", format: "binary" } } } });

/** Работа для машины: вопрос модели. Пусто — 204, мост тут же приходит снова. */
export const bridgeJob = z.object({ jobId: z.string(), system: z.string(), prompt: z.string() });

/**
 * Ответ машины на работу: либо отказ модели словами, либо текст. Непустой
 * `error` важнее `text` — так мост сообщает, что модель отказала.
 */
export const bridgeAnswerBody = z.union([
  z.object({ jobId: text().min(1), error: text().trim().min(1), text: text().optional() }),
  z.object({ jobId: text().min(1), text: text(), error: text().optional() }),
]);
export const bridgeAnswered = z.object({ outcome: z.enum(["доставлено", "никто-не-ждал"]) });

/** Живая проверка модели через свой мост. */
export const modelCheck = z.object({ text: z.string(), ms: z.number() });

/** Ответ агента на обращение: реплика уже в ленте, здесь — её номер и время. */
export const answerView = z.object({ messageId: id, body: z.string(), ms: z.number() });

/** «Жив ли ты» и что стоит в установке (Р-030 ⑥). `null` — честное «не знаю». */
export const healthView = z.object({
  status: z.literal("ok"),
  database: z.literal("ok"),
  version: z.string().nullable(),
  migrations: z.number().nullable(),
});
export const healthDegraded = z.object({
  status: z.literal("degraded"),
  database: z.literal("unreachable"),
});

/* ── типы для фронта ───────────────────────────────────────────────── */

export type Me = z.infer<typeof meView>;
export type AgentsView = z.infer<typeof agentsView>;
export type ModelKey = z.infer<typeof modelKeyView>;
export type Bridge = z.infer<typeof bridgeView>;
export type InviteCreated = z.infer<typeof inviteCreated>;
export type BridgeIssued = z.infer<typeof bridgeIssued>;
export type ModelCheck = z.infer<typeof modelCheck>;
export type AnswerView = z.infer<typeof answerView>;

export type Project = z.infer<typeof projectView>;
export type PanelSnapshot = z.infer<typeof panelSnapshot>;
export type Conversation = z.infer<typeof conversationView>;
export type Quote = z.infer<typeof quoteView>;
export type Message = z.infer<typeof messageView>;
export type Tombstone = z.infer<typeof tombstoneView>;
export type SyncLine = Message | Tombstone;
export type ChangeEvent = z.infer<typeof changeEvent>;
export type Person = z.infer<typeof personView>;
export type SearchHit = z.infer<typeof searchHit>;
export type SearchPage = z.infer<typeof searchPage>;
