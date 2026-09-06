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

export const api = {
  me: () => request<Me>("/v1/me"),
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
