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

export interface FieldErrors {
  error: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: FieldErrors,
  ) {
    super(body.error);
  }
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

export interface Message {
  id: string;
  conversationId: string;
  body: string;
  kind: string;
  seq: number;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; kind: string };
}

/** На чём агент основал предложение. Настоящая ссылка, а не слепок. */
export interface Citation {
  messageId: string;
  /** Номер в ленте: по нему открывается нужное место разговора. */
  seq: number;
  quote: string;
  /** Кто это сказал. Автор РЕПЛИКИ, а не автор предложения. */
  authorName: string;
}

export interface Agreement {
  id: string;
  conversationId: string;
  conversationTitle: string;
  text: string;
  status: string;
  proposedBy: { id: string; name: string };
  confirmedBy: string | null;
  createdAt: string;
  citations: Citation[];
}

export interface Task {
  id: string;
  agreementId: string;
  title: string;
  status: string;
  createdAt: string;
  conversationId: string;
  conversationTitle: string;
  citations: Citation[];
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
  send: (id: string, body: string, clientMsgId: string) =>
    request<Message>(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMsgId }),
    }),

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
  ask: (id: string) =>
    request<{ messageId: string; body: string; ms: number } | null>(`/v1/conversations/${id}/ask`, {
      method: "POST",
      body: "{}",
    }),

  /** Новый канал. Виден всему пространству, если не сказано иначе (Р-010). */
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

  /**
   * Выпустить приглашение. Токен приходит ОДИН раз и больше не
   * восстановим: в базе лежит только его хеш (Р-009).
   */
  createInvite: () =>
    request<{ id: string; token: string; expiresAt: string }>("/v1/invites", {
      method: "POST",
      body: "{}",
    }),

  /** Догон по номеру — им же клиент и живёт, и восстанавливается (Р-006). */
  sync: (after: number) =>
    request<{ messages: Message[]; seq: number; hasMore: boolean }>(`/v1/sync?after=${after}`),

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => request<Me>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }),
  /** Единственный путь присоединиться к чужому пространству (Р-009). */
  join: (input: { token: string; email: string; password: string; displayName: string }) =>
    request<Me>("/v1/auth/join", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<Me>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),

  /** Договорённости пространства: и ждущие решения, и решённые. */
  agreements: () => request<{ items: Agreement[] }>("/v1/agreements"),
  tasks: () => request<{ items: Task[] }>("/v1/tasks"),

  /**
   * Подтвердить или отклонить. Сервер пускает сюда только человека —
   * не потому, что мы не доверяем агенту, а потому что это гейт одобрения.
   */
  decide: (id: string, verdict: "confirm" | "reject") =>
    request<Agreement>(`/v1/agreements/${id}/${verdict}`, { method: "POST", body: "{}" }),

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

  /**
   * Разобрать разговор: агент читает ленту и предлагает договорённости.
   *
   * Пока это КНОПКА. Агент не слушает сам — на это нужен ответ про лимиты
   * тарифа (О-1, О-2), иначе каждое сообщение уходило бы в модель.
   */
  listen: (conversationId: string) =>
    request<{ proposed: number }>(`/v1/conversations/${conversationId}/listen`, {
      method: "POST",
      body: "{}",
    }),
};
