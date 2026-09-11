/**
 * Общие помощники приёмочных: адрес стенда, запросы, люди.
 *
 * Одно место на все файлы. Прежде эти двадцать строк жили копией
 * в двадцати одном файле — и копии уже разошлись: где-то печенька
 * бросает ошибку, где-то отдаёт `null`, где-то почта с кириллицей.
 */
import { expect } from "vitest";

export const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
export const PASSWORD = "правильный-конский-скотч-батарейка";

/** Свежая почта. Только латиница: кириллица в местной части даёт 422. */
export function freshEmail(tag = "stand"): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export interface Person {
  cookie: string;
  participantId: string;
  workspaceId: string;
  name: string;
}

function sessionCookie(response: Response): string {
  const header = (response.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith("amplifie_session="),
  );
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

export function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  person?: Person,
  body?: unknown,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(person ? { cookie: person.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function asPerson(response: Response, name: string): Promise<Person> {
  const body = (await response.json()) as {
    participant: { id: string };
    workspace: { id: string };
  };
  return {
    cookie: sessionCookie(response),
    participantId: body.participant.id,
    workspaceId: body.workspace.id,
    name,
  };
}

/** Новый человек со своей компанией. */
export async function newPerson(name: string): Promise<Person> {
  const response = await call("POST", "/v1/auth/register", undefined, {
    email: freshEmail(),
    password: PASSWORD,
    displayName: name,
    workspaceName: `Пространство ${name}`,
  });
  expect(response.status, `регистрация «${name}»`).toBe(201);
  return asPerson(response, name);
}

/** Второй человек в той же компании — по ссылке приглашения. */
export async function colleague(owner: Person, name: string): Promise<Person> {
  const created = await call("POST", "/v1/invites", owner, { maxUses: 50 });
  expect(created.status, "приглашение").toBe(201);
  const { token } = (await created.json()) as { token: string };
  const entered = await call("POST", "/v1/auth/join", undefined, {
    token,
    email: freshEmail(),
    password: PASSWORD,
    displayName: name,
  });
  expect(entered.status, `вход «${name}» по ссылке`).toBe(201);
  return asPerson(entered, name);
}

/** Стенд поднят — иначе тесты падают с непонятной ошибкой сети. */
export async function requireStand(): Promise<void> {
  const health = await call("GET", "/health");
  if (!health.ok) throw new Error(`стек не поднят (${health.status}) — сначала make up`);
}
