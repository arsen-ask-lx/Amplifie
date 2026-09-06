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
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({ error: "bad_response" }));
  if (!response.ok) throw new ApiError(response.status, body as FieldErrors);
  return body as T;
}

export interface Conversation {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
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

  /** Догон по номеру — им же клиент и живёт, и восстанавливается (Р-006). */
  sync: (after: number) =>
    request<{ messages: Message[]; seq: number; hasMore: boolean }>(`/v1/sync?after=${after}`),

  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => request<Me>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<Me>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),
};
