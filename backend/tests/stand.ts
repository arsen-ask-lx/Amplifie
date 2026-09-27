/**
 * Общие помощники приёмочных: адрес стенда, запросы, люди.
 *
 * Одно место на все файлы. Прежде эти двадцать строк жили копией
 * в двадцати одном файле — и копии уже разошлись: где-то печенька
 * бросает ошибку, где-то отдаёт `null`, где-то почта с кириллицей.
 */
import { expect } from "vitest";

// ⚠️ Имя переменной — НЕ `BASE_URL`: туда Vite подставляет "/", и запросы уходили бы
// мимо стенда (перенесено из прежних копий в auth и chat при сведении помощников).
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

/**
 * Печенька сессии из ответа входа — `amplifie_session=<значение>`.
 * Нет печеньки — ошибка, а не `null`: без неё тест дальше идти не может.
 */
export function sessionCookie(response: Response): string {
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

/**
 * Слушать поток человека и сказать, пришёл ли звонок «изменилось».
 *
 * Возвращает функцию ожидания: поток открывается ДО действия, иначе звонок
 * успел бы пролететь раньше подписки. Читается сырой поток, а не
 * EventSource: его в тестовой среде нет.
 */
export async function listen(person: Person): Promise<(timeoutMs?: number) => Promise<boolean>> {
  const stop = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie: person.cookie },
    signal: stop.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("у потока нет тела");
  const decoder = new TextDecoder();

  return async (timeoutMs = 3000) => {
    const timer = setTimeout(() => stop.abort(), timeoutMs);
    let seen = "";
    try {
      while (!seen.includes("event: changed")) {
        const { done, value } = await reader.read();
        if (done) return false;
        seen += decoder.decode(value, { stream: true });
      }
      return true;
    } catch {
      // Оборвали по сроку — звонка не было. Это ответ, а не поломка.
      return false;
    } finally {
      clearTimeout(timer);
      stop.abort();
    }
  };
}

/**
 * Слушать поток и читать САМИ звонки, а не только факт звонка.
 *
 * ЗАЧЕМ ВТОРОЙ СЛУШАТЕЛЬ. `listen` отвечает «звонок был или не был» —
 * этого хватало, пока звонок был пустым. С адресом изменения (task-067)
 * проверять надо содержимое звонка и то, что чужой адрес не приезжает
 * вовсе. Boolean на такой вопрос не отвечает.
 *
 * Поток открывается ДО действия: звонок, пролетевший раньше подписки,
 * потерян, и тест соврал бы «не пришло».
 */
export interface CallSeen {
  conversation: string | null;
  /** Папка разговора с репликой (task-119). Чат вне папок — поля нет. */
  project?: string;
  /**
   * Сама реплика, если сервер сумел описать изменение точно (task-085).
   *
   * Тип намеренно сырой: главная проверка — что этот объект совпадает
   * с ответом догона ЦЕЛИКОМ. Объяви мы здесь свою форму — сравнение
   * шло бы с ней, а не с тем, что отдаёт сервер.
   */
  line?: unknown;
  /**
   * Кого позвали этой репликой (task-092). Нет зовов — поля нет вовсе.
   *
   * Клиент считает счётчик зовов приращением и посчитать его по тексту
   * не может: зов живёт в теле реплики (Р-020).
   */
  mentions?: string[];
}

/** Один кадр потока: звонок это или что-то другое (биение, комментарий). */
function callOf(frame: string): CallSeen | null {
  if (!frame.includes("event: changed")) return null;
  const line = frame.split("\n").find((one) => one.startsWith("data:"));
  const raw = (line ?? "").slice("data:".length).trim();
  const parsed = JSON.parse(raw === "" ? "{}" : raw) as {
    conversation?: string | null;
    line?: unknown;
    mentions?: string[];
    project?: string;
  };
  return {
    conversation: parsed.conversation ?? null,
    ...(parsed.line === undefined ? {} : { line: parsed.line }),
    ...(parsed.mentions === undefined ? {} : { mentions: parsed.mentions }),
    ...(parsed.project === undefined ? {} : { project: parsed.project }),
  };
}

/** Первый готовый звонок из накопленного; `rest` — что осталось разобрать. */
function firstCall(buffer: string): { call: CallSeen | null; rest: string } {
  let rest = buffer;
  for (;;) {
    const at = rest.indexOf("\n\n");
    if (at < 0) return { call: null, rest };
    const frame = rest.slice(0, at);
    rest = rest.slice(at + 2);
    const call = callOf(frame);
    if (call) return { call, rest };
  }
}

export async function listenCalls(person: Person): Promise<{
  /** Следующий звонок или `null`, если за срок его не случилось. */
  next: (timeoutMs?: number) => Promise<CallSeen | null>;
  stop: () => void;
}> {
  const stop = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie: person.cookie },
    signal: stop.signal,
  });
  const body = response.body;
  if (!body) throw new Error("у потока нет тела");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /** Забрать звонок, уже лежащий в буфере. */
  function taken(): CallSeen | null {
    const { call, rest } = firstCall(buffer);
    buffer = rest;
    return call;
  }

  async function awaited(): Promise<CallSeen | null> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      const call = taken();
      if (call) return call;
    }
  }

  return {
    async next(timeoutMs = 3000) {
      const ready = taken();
      if (ready) return ready;
      const timer = setTimeout(() => stop.abort(), timeoutMs);
      try {
        return await awaited();
      } catch {
        // Оборвали по сроку — звонка не было. Это ответ, а не поломка.
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    stop: () => stop.abort(),
  };
}

/** Стенд поднят — иначе тесты падают с непонятной ошибкой сети. */
export async function requireStand(): Promise<void> {
  const health = await call("GET", "/health");
  if (!health.ok) throw new Error(`стек не поднят (${health.status}) — сначала make up`);
}
