import type {
  ChangeEvent,
  Conversation,
  Message,
  PanelSnapshot,
  Person,
  Project,
  Quote,
  SearchHit,
  SearchPage,
  SyncLine,
  Tombstone,
} from "@amplifie/contract/api";
import { ApiError, type FieldErrors } from "../shared/failure.js";
import { patient } from "./patient.js";

/**
 * Формы ответов чата — из общего контракта (Р-034), а не своими копиями:
 * сменился ответ сервера — фронт перестаёт собираться там, где читает
 * старое поле. Только типы: zod в сборку фронта не едет.
 */
export type {
  ChangeEvent,
  Conversation,
  Message,
  PanelSnapshot,
  Person,
  Project,
  Quote,
  SearchHit,
  SearchPage,
  SyncLine,
  Tombstone,
};

/** Порция строк панели: сами строки и курсор продолжения (`null` — конец). */
export interface Page {
  items: Conversation[];
  next: string | null;
}

/**
 * Единственное место, где фронт ходит на сервер.
 *
 * Печенька сессии — HttpOnly, поэтому JS её не видит и не может: браузер
 * шлёт её сам при credentials: "include". Хранить токен в localStorage
 * запрещено — это первое, что забирают при XSS.
 */

export interface Me {
  account: { id: string; email: string };
  participant: { id: string; displayName: string; kind: string; role: string };
  workspace: { id: string; name: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // ⚠️ content-type ТОЛЬКО там, где есть тело.
  //
  // Раньше заголовок ставился всегда, и запрос без тела — например, DELETE —
  // сервер отвергал с FST_ERR_CTP_EMPTY_JSON_BODY: «тело не может быть
  // пустым, если объявлен JSON». Кнопка «Убрать» молча ничего не делала.
  //
  // Приёмочный тест это пропустил: в нём заголовок ставился по правилу
  // настоящего браузера, а не по правилу ЭТОГО клиента. Нашлось живым
  // прогоном — см. лог task-008.
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...headers, ...(init?.headers ?? {}) },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({ error: "bad_response" }));
  if (!response.ok) throw new ApiError(response.status, body as FieldErrors);
  return body as T;
}

/**
 * Загрузка, без которой нет экрана, — терпит короткий сбой сервера (task-096).
 *
 * ⚠️ ЯВНЫЙ СПИСОК, А НЕ ВСЕ ЧТЕНИЯ. Терпят четыре двери ниже: кто я,
 * панель, первая страница ленты, закреплённое. У догона и потока свой
 * хозяин повтора, у опросов — свой таймер, порции панели перечитываются
 * по звонку: повтор внутри них умножил бы запросы.
 */
function patiently<T>(path: string, signal?: AbortSignal): Promise<T> {
  return patient((attempt) => request<T>(path, { signal: attempt }), signal);
}

export interface AgentsView {
  items: Array<{ id: string; name: string; kind: string; answersOn: string }>;
  /** Мост СПРАШИВАЮЩЕГО: агент отвечает через его подписку, не через чужую. */
  bridge: { connected: boolean; online: boolean; name: string | null };
  /** Чем будет оплачен вызов, если позвать агента прямо сейчас. */
  answersVia: { kind: string; hint: string | null };
}

/** Ключ поставщика. Самого ключа здесь нет и не будет — только подсказка. */
export interface ModelKey {
  id: string;
  provider: string;
  hint: string;
  scope: "участник" | "пространство";
  createdAt: string;
}

/** Надгробие ли это. Разбор в одном месте, а не по «if» у каждого читателя. */
export function isTombstone(line: SyncLine): line is Tombstone {
  return "deleted" in line && line.deleted;
}

/** Мост — машина участника, на которой живёт его подписка (task-001). */
export interface Bridge {
  id: string;
  name: string | null;
  /** Код погашен, машина подключалась хотя бы раз. */
  joined: boolean;
  /** Приходил за работой недавно — значит спросить можно прямо сейчас. */
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export const api = {
  me: (signal?: AbortSignal) => patiently<Me>("/v1/me", signal),
  /**
   * Все видимые разговоры одним ответом, без предела и страниц.
   *
   * ⚠️ ПАНЕЛЬ ЭТО БОЛЬШЕ НЕ ЗОВЁТ — с task-064 она берёт `panel()` и курсорные
   * двери. Единственный живой потребитель — окно «куда переслать»
   * (`ForwardPicker`): панель грузит чаты порциями, и в ней нет тех,
   * чья папка свёрнута, а переслать туда человек вправе.
   *
   * ⚠️ И ИМЕННО ПОЭТОМУ ЗДЕСЬ ДОЛГ ([Д-41](../../../dock/debt.md#d-41)).
   * На засеянной базе ответ — 1,4 МБ и 5 241 строка, а в самом окне нет
   * даже поля поиска: при пяти тысячах чатов человек листает их глазами.
   * Решение владельца 16.09.2026: дверь получит `?q=&limit=` и станет
   * отвечать «найди чат», а не «отдай всё». До тех пор — как есть.
   */
  conversations: () => request<{ items: Conversation[]; projects: Project[] }>("/v1/conversations"),

  /**
   * Сводный ответ панели (Р-037): папки со счётчиками, первая порция
   * «Недавних» и строка открытого чата. Чаты папки приезжают отдельно —
   * когда её раскрыли.
   *
   * ⚠️ ЭТО ЗАМЕНА ПОЛНОМУ СПИСКУ, А НЕ ДОБАВКА К НЕМУ. Полный ответ вёз
   * все разговоры пространства: 1,4 МБ на каждое сообщение в любом чате
   * (замер 11.09 на 5 241 чате). Сводный — 20 КБ.
   */
  panel: (open?: string | null) =>
    patiently<PanelSnapshot>(`/v1/panel${open ? `?open=${encodeURIComponent(open)}` : ""}`),

  /** Следующая порция «Недавних» — чатов без папки. */
  recent: (cursor: string) =>
    request<Page>(`/v1/conversations/recent?cursor=${encodeURIComponent(cursor)}`),

  /** Порция чатов проекта: первая — 10, следующие — по 25. */
  projectChats: (projectId: string, cursor?: string | null) =>
    request<Page>(
      `/v1/projects/${projectId}/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),

  /** Завести проект. Прав он не несёт, поэтому заводить может любой. */
  addProject: (title: string, look?: { icon?: string | null; color?: string | null }) =>
    request<Project>("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ title, ...look }),
    }),

  /**
   * Закрепить разговор в СВОЕЙ панели либо снять закрепление (task-038).
   *
   * ⚠️ ЛИЧНОЕ. У коллеги порядок свой — это решение владельца (Д-32),
   * и держит его сервер: клиент ничего не сортирует.
   */
  pinConversation: (id: string, pinned: boolean) =>
    request<void>(`/v1/conversations/${id}/pin`, { method: pinned ? "POST" : "DELETE" }),

  /** Закрепить проект в своей панели либо снять закрепление. */
  pinProject: (id: string, pinned: boolean) =>
    request<void>(`/v1/projects/${id}/pin`, { method: pinned ? "POST" : "DELETE" }),

  /** Переименовать проект. */
  /** Поправить папку: имя и/или вид. Не переданное не меняется. */
  renameProject: (
    id: string,
    edit: { title?: string; icon?: string | null; color?: string | null },
  ) => request<Project>(`/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(edit) }),

  /** Убрать проект. Папка исчезает, переписка остаётся (Р-032). */
  removeProject: (id: string) => request<void>(`/v1/projects/${id}`, { method: "DELETE" }),

  /** Отнести чат к проекту либо снять принадлежность (`null`). */
  moveConversation: (id: string, projectId: string | null) =>
    request<{ id: string; projectId: string | null }>(`/v1/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ projectId }),
    }),

  /**
   * Лента разговора. `before` — страница старше номера, `after` — новее
   * (task-099). `patient` — терпеть короткий сбой сервера: так грузится
   * то, без чего экрана нет; листание краёв не терпит.
   */
  messages: (
    id: string,
    options: {
      limit?: number;
      before?: number;
      after?: number;
      /** Открыть ленту на первом непрочитанном (task-107) — считает сервер. */
      around?: "unread";
      patient?: boolean;
      signal?: AbortSignal;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.before) query.set("before", String(options.before));
    if (options.around) query.set("around", options.around);
    if (options.after !== undefined) query.set("after", String(options.after));
    const path = `/v1/conversations/${id}/messages${query.size > 0 ? `?${query}` : ""}`;
    type FeedPage = {
      items: Message[];
      hasMore: boolean;
      head: number;
      /** Оба поля приходят только у окна «на непрочитанном» (task-107). */
      hasNewer?: boolean;
      readSeq?: number;
    };
    const patientByDefault = !options.before && options.after === undefined;
    return (options.patient ?? patientByDefault)
      ? patiently<FeedPage>(path, options.signal)
      : request<FeedPage>(path, options.signal ? { signal: options.signal } : undefined);
  },

  /**
   * Отправка. `clientMsgId` рождается в момент набора и не меняется при
   * повторе: сервер по нему узнаёт то же самое сообщение и не заводит второе.
   */
  send: (
    id: string,
    body: string,
    clientMsgId: string,
    links: { replyToId?: string; forwardedFromId?: string } = {},
  ) =>
    request<Message>(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMsgId, ...links }),
    }),

  /** Закреплённое разговора. Отдельной дверью: полоска нужна с первого кадра. */
  pinned: (id: string, signal?: AbortSignal) =>
    patiently<{ items: Message[] }>(`/v1/conversations/${id}/pinned`, signal),

  edit: (messageId: string, body: string) =>
    request<Message>(`/v1/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),

  remove: (messageId: string) => request<void>(`/v1/messages/${messageId}`, { method: "DELETE" }),

  pin: (messageId: string, pinned: boolean) =>
    request<void>(`/v1/messages/${messageId}/pin`, { method: pinned ? "POST" : "DELETE" }),

  /** Агенты пространства и состояние МОЕГО моста — через него они отвечают. */
  agents: () => request<AgentsView>("/v1/agents"),

  /** Мои ключи и ключи пространства. Чужих личных здесь не бывает. */
  modelKeys: () => request<{ items: ModelKey[] }>("/v1/model-keys"),

  /**
   * Сохранить ключ. Уходит один раз и обратно НЕ возвращается: в ответе
   * только подсказка из последних знаков.
   */
  addModelKey: (input: { provider: string; key: string; scope: string }) =>
    request<ModelKey>("/v1/model-keys", { method: "POST", body: JSON.stringify(input) }),

  removeModelKey: (id: string) => request<void>(`/v1/model-keys/${id}`, { method: "DELETE" }),

  /**
   * Позвать агента разобрать разговор.
   *
   * Зовётся ПОСЛЕ отправки, отдельным запросом: сообщение обязано
   * записаться мгновенно и не зависеть от модели. 204 — обращения
   * не было, это обычный ход, а не ошибка.
   */
  /**
   * Позвать агента. `scope` — насколько широко он читает (Р-032):
   * этот разговор либо весь проект.
   */
  ask: (id: string, scope: "conversation" | "project" = "conversation") =>
    request<{ messageId: string; body: string; ms: number } | null>(`/v1/conversations/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),

  /** Новый канал. Виден всему пространству, если не сказано иначе (Р-010). */
  /** Удалить канал. Мягко на сервере; здесь это просто «его больше нет». */
  removeChannel: (id: string) => request<void>(`/v1/conversations/${id}`, { method: "DELETE" }),

  /**
   * Отметить разговор прочитанным ДО номера включительно.
   *
   * Возвращает остаток, пересчитанный сервером: клиент видит только окно
   * ленты и посчитать сам не может (Р-029).
   */
  /**
   * Поиск по сообщениям всех видимых разговоров (task-100). Текст — в теле:
   * в адресе он попал бы в журналы. `before` — курсор следующей страницы.
   * Не терпит сбой: человек набирает дальше, и новый запрос отменит этот.
   */
  /**
   * Поиск по сообщениям. `conversationId` — искать только в этом чате
   * (task-106): тогда ответ несёт ещё и число всех попаданий для счётчика
   * «3 из 17». Без него — поиск по всем видимым чатам, как окно Ctrl+K.
   */
  search: (
    q: string,
    options: { before?: number; conversationId?: string; signal?: AbortSignal } = {},
  ) =>
    request<SearchPage>("/v1/search/messages", {
      method: "POST",
      body: JSON.stringify({
        q,
        ...(options.before ? { before: options.before } : {}),
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    }),

  markRead: (id: string, seq: number) =>
    request<{ unread: number }>(`/v1/conversations/${id}/read`, {
      method: "POST",
      body: JSON.stringify({ seq }),
    }),

  /**
   * Кого можно позвать в этом разговоре (Р-031).
   *
   * Вопрос задан РАЗГОВОРУ, а не пространству: в приватном канале звать
   * можно только тех, кто его видит.
   */
  people: (conversationId: string) =>
    request<{ items: Person[] }>(`/v1/conversations/${conversationId}/people`),

  /**
   * Номер самого раннего неувиденного упоминания либо `null`.
   *
   * Клиент сам ответить не может: он держит окно в 300 реплик, а зов
   * может лежать за его краем.
   */
  nearestMention: (conversationId: string) =>
    request<{ seq: number | null }>(`/v1/conversations/${conversationId}/mention`),

  /**
   * Завести канал. `projectId` — сразу внутрь проекта (task-035): одним
   * запросом, а не «завести и переложить».
   */
  createChannel: (title: string, projectId?: string) =>
    request<Conversation>("/v1/conversations", {
      method: "POST",
      body: JSON.stringify(projectId ? { title, projectId } : { title }),
    }),

  /** Ветка внутри канала. Своих участников не имеет — наследует канал. */
  createThread: (channelId: string, title: string) =>
    request<Conversation>(`/v1/conversations/${channelId}/threads`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  /** Догон по номеру — им же клиент и живёт, и восстанавливается (Р-006). */
  sync: (after: number) =>
    request<{ messages: SyncLine[]; seq: number; hasMore: boolean }>(`/v1/sync?after=${after}`),

  /**
   * Что за дверью: можно ли здесь завести компанию (task-023).
   *
   * Спрашивается ДО входа и без печеньки: отвечает на вопрос экрана
   * «показать установку или вход».
   */
  entry: () => request<{ registrationOpen: boolean }>("/v1/entry"),

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => request<Me>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<Me>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),

  /**
   * Позвать в пространство: ссылка выдаётся ОДИН раз.
   *
   * В базе живёт только хеш токена, поэтому «показать ту же ссылку»
   * невозможно ни нам, ни кому-либо ещё. Потерял — сделай новую.
   */
  invite: () =>
    request<{ id: string; token: string; expiresAt: string; maxUses: number }>("/v1/invites", {
      method: "POST",
      body: "{}",
    }),

  /**
   * Войти по приглашению — ОТДЕЛЬНАЯ дверь, а не регистрация с полем.
   *
   * ⚠️ РЕГИСТРАЦИЯ ТОКЕН НЕ ПРИНИМАЕТ И НЕ ДОЛЖНА. Класс уязвимости,
   * ради которого это разделено (Р-009): тот же токен через ДРУГОЙ поток
   * входа обходил проверку доступа.
   */
  join: (input: { token: string; email: string; password: string; displayName: string }) =>
    request<Me>("/v1/auth/join", { method: "POST", body: JSON.stringify(input) }),

  /** Мосты участника: и подключённые, и ещё не погашенные коды. */
  bridges: () => request<{ items: Bridge[] }>("/v1/bridges"),

  /**
   * Выдать код подключения. Код и готовая строка запуска приходят ОДИН раз:
   * в базе только хеш, как у приглашения (Р-009).
   */
  createBridgeCode: () =>
    request<{ id: string; code: string; command: string; expiresAt: string }>("/v1/bridges", {
      method: "POST",
      body: "{}",
    }),

  /** Живая проверка: спросить настоящую модель через свой мост. */
  checkModel: (prompt?: string) =>
    request<{ text: string; ms: number }>("/v1/model/check", {
      method: "POST",
      body: JSON.stringify(prompt ? { prompt } : {}),
    }),
};
