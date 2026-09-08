import { ApiError, type FieldErrors } from "../shared/failure.js";

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

export interface Conversation {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
  /** Когда тут в последний раз говорили. По нему сервер и сортирует. */
  lastAt?: string;
}

/** На что отвечает реплика. Кусок текста присылает сервер — здесь не режем. */
export interface Quote {
  id: string;
  seq: number;
  author: string;
  excerpt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  body: string;
  kind: string;
  seq: number;
  createdAt: string;
  editedAt: string | null;
  /** Когда закреплено. `null` — не закреплено. */
  pinnedAt: string | null;
  author: { id: string; name: string; kind: string };
  /**
   * Цитата. `null` — ответа не было ЛИБО исходную реплику удалили; снаружи
   * это одно и то же намеренно: цитата на удалённое не должна показывать
   * ни текст, ни пустую рамку.
   */
  replyTo: Quote | null;
  /** Имя того, от кого переслано. `null` — не пересылка. */
  forwardedFrom: string | null;
}

/**
 * Надгробие: реплику удалили.
 *
 * ⚠️ ПРИХОДИТ ТОЛЬКО ДОГОНОМ И ТОЛЬКО ТОМУ, У КОГО РЕПЛИКА УЖЕ ЕСТЬ.
 * Тому, кто открывает переписку впервые, ни реплики, ни надгробия не видно:
 * надгробие — это указание «убери со своего экрана», а не запись в ленте.
 *
 * Текста здесь нет и не будет: сервер его не отдаёт вовсе.
 */
export interface Tombstone {
  id: string;
  conversationId: string;
  seq: number;
  deleted: true;
}

/** Что приезжает догоном. */
export type SyncLine = Message | Tombstone;

/** Надгробие ли это. Разбор в одном месте, а не по «if» у каждого читателя. */
export function isTombstone(line: SyncLine): line is Tombstone {
  return "deleted" in line && line.deleted;
}

/**
 * Задача в том виде, в каком ею пользуется доска.
 *
 * ⚠️ ЗДЕСЬ НЕ ВЕСЬ ОТВЕТ СЕРВЕРА, а только то, что читает экран. Копировать
 * серверную форму целиком значит завести вторую её копию, которая разъедется
 * при первом же изменении, — и мы это уже проходили сегодня с `agreementId`.
 */
export interface Task {
  id: string;
  title: string;
  /** Колонка доски. Список закрыт сервером и базой. */
  stage: string;
  createdAt: string;
  assignedTo: { id: string; name: string; kind: string } | null;
  /** Всегда человек: это держит база, а не экран. */
  responsible: { id: string; name: string } | null;
  /** Обсуждение задачи. Пусто, пока не было ни одного прогона. */
  discussionId: string | null;
  /** Отказов подряд. Два — размыкатель разомкнут, нужен человек. */
  failedRuns: number;
}

export interface Participant {
  id: string;
  name: string;
  kind: string;
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
  me: () => request<Me>("/v1/me"),
  conversations: () => request<{ items: Conversation[] }>("/v1/conversations"),

  /** Лента разговора. `before` — номер, старше которого нужна страница. */
  messages: (id: string, options: { limit?: number; before?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.before) query.set("before", String(options.before));
    const tail = query.size > 0 ? `?${query}` : "";
    return request<{ items: Message[]; hasMore: boolean }>(
      `/v1/conversations/${id}/messages${tail}`,
    );
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
  pinned: (id: string) => request<{ items: Message[] }>(`/v1/conversations/${id}/pinned`),

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

  /** Кого можно назначить исполнителем. */
  participants: () => request<{ items: Participant[] }>("/v1/participants"),

  /** Завести задачу руками — без договорённости (task-010). */
  addTask: (input: { title: string; responsibleId: string; assignedToId?: string | null }) =>
    request<Task>("/v1/tasks", { method: "POST", body: JSON.stringify(input) }),

  /** Пусть агент сделает задачу. Платит нажавший (Р-016). */
  runTask: (id: string) =>
    request<{ taskId: string; discussionId: string; ms: number }>(`/v1/tasks/${id}/run`, {
      method: "POST",
      body: "{}",
    }),

  /** Подвинуть по доске либо переназначить. */
  patchTask: (
    id: string,
    patch: { stage?: string; assignedToId?: string | null; responsibleId?: string },
  ) => request<Task>(`/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

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
  ask: (id: string) =>
    request<{ messageId: string; body: string; ms: number } | null>(`/v1/conversations/${id}/ask`, {
      method: "POST",
      body: "{}",
    }),

  /** Новый канал. Виден всему пространству, если не сказано иначе (Р-010). */
  /** Удалить канал. Мягко на сервере; здесь это просто «его больше нет». */
  removeChannel: (id: string) => request<void>(`/v1/conversations/${id}`, { method: "DELETE" }),

  createChannel: (title: string) =>
    request<Conversation>("/v1/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
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

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => request<Me>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<Me>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),

  tasks: () => request<{ items: Task[] }>("/v1/tasks"),

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
