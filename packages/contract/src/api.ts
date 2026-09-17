import { z } from "zod";
import { PROJECT_COLORS, PROJECT_ICONS } from "./projectLook.js";

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
 * Все видимые разговоры одним ответом. Панель этим больше не пользуется
 * (с task-064 у неё `panelSnapshot` и курсорные двери) — форма осталась
 * у `/v1/conversations`, которую зовёт окно пересылки. Без предела
 * и страниц: это Д-41/Д-15, и чинится поиском, а не обрезкой.
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
});

export const messagesPage = z.object({
  items: z.array(messageView),
  hasMore: z.boolean(),
  /** Голова пространства — начальный курсор догона (Д-19). */
  head: z.number(),
});

export const pinnedList = z.object({ items: z.array(messageView) });

/**
 * Найденное поиском (task-100): тот же вид реплики, что в ленте, плюс
 * название чата — выдача идёт по всем разговорам сразу. Своей формы
 * реплики у поиска нет: разойдись она с лентой — найденное выглядело бы
 * не так, как то же сообщение в чате.
 */
export const searchHit = messageView.extend({ conversationTitle: z.string() });

/** Страница поиска. `next` — курсор следующей страницы; `null` — дальше нет. */
export const searchPage = z.object({
  items: z.array(searchHit),
  next: z.number().nullable(),
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

const body = z
  .string()
  .trim()
  .min(1, "сообщение пустое")
  .max(8000, "сообщение длиннее 8000 символов");

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
  q: z.string().max(200, "запрос длиннее 200 символов"),
  before: z.int().positive().optional(),
  limit: z.int().min(1).max(50).optional(),
});

export const readBody = z.object({ seq: z.int().min(0, "номер не бывает отрицательным") });

export const channelBody = z.object({
  title: z.string().trim().min(1, "у канала нужно название").max(120),
  /** Завести сразу внутри проекта (task-035). */
  projectId: id.optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
});

export const threadBody = z.object({
  title: z.string().trim().min(1, "у ветки нужно название").max(200),
});

/**
 * Проект: имя и вид. `null` — «убрать вид», отсутствие поля — «не трогать»:
 * слить их значило бы стирать цвет при каждом переименовании.
 */
export const projectBody = z.object({
  title: z.string().trim().min(1, "у проекта нужно название").max(120),
  icon: z.enum(PROJECT_ICONS).nullable().optional(),
  color: z.enum(PROJECT_COLORS).nullable().optional(),
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
    limit: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .refine((query) => query.before === undefined || query.after === undefined, {
    message: "страница ленты идёт либо назад (before), либо вперёд (after)",
  });
export const cursorQuery = z.object({ cursor: z.string().optional() });

/** Какой чат открыт в этой вкладке: его строка нужна ленте. */
export const openQuery = z.object({ open: id.optional() });
export const syncQuery = z.object({
  after: z.string().optional(),
  limit: z.string().optional(),
});

/* ── типы для фронта ───────────────────────────────────────────────── */

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
