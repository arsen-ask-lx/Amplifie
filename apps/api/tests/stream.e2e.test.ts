/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЖИВЫХ ОБНОВЛЕНИЙ (Р-006). Написан ДО кода и обязан быть красным.
 *
 * Свойство, ради которого всё делается: **написанное одним доезжает до
 * другого без опроса сервера по кругу** — и доезжает ЧЕРЕЗ CADDY, а не мимо.
 * Проверка через настоящий порт тут не формальность: сжатие и буферизация
 * прокси ломают поток так, что напрямую в api всё выглядит исправным.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8080";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `stream-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Person {
  cookie: string;
  channelId: string;
}

async function newPerson(tag: string): Promise<Person> {
  const registered = await fetch(`${BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
      workspaceName: `Пространство ${tag}`,
    }),
  });
  if (registered.status !== 201) throw new Error(`регистрация: ${registered.status}`);
  const cookie = sessionCookie(registered);

  const list = await fetch(`${BASE}/v1/conversations`, { headers: { cookie } });
  const items = ((await list.json()) as { items: Array<{ id: string }> }).items;
  const channelId = items[0]?.id;
  if (!channelId) throw new Error("у нового человека нет канала");
  return { cookie, channelId };
}

async function send(person: Person, body: string): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${person.channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify({ body, clientMsgId: crypto.randomUUID() }),
  });
}

/**
 * Разбор потока SSE на кадры.
 *
 * Читаем руками, а не через EventSource: его в тестовой среде нет, а нам
 * к тому же надо видеть СЫРЫЕ байты — именно по ним заметно, что прокси
 * накопил их в буфере вместо того, чтобы отдать сразу.
 *
 * Вынесено на верхний уровень, а не спрятано в listen: вложенность сама
 * по себе стоит сложности, а порог сложности мы не поднимаем.
 */
function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  // Последний кусок — недочитанный хвост: он станет кадром, когда доедет
  // его разделитель. Отдать его сейчас значило бы порвать кадр пополам.
  return { frames: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

/** Звонки из потока по одному; сердцебиение отфильтровано. */
async function* nudgesOf(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) throw new Error("у ответа нет тела");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  for (;;) {
    const { frames, rest } = splitFrames(buffered);
    buffered = rest;
    for (const frame of frames) {
      if (!frame.startsWith(":")) yield frame;
    }
    const { value, done } = await reader.read();
    if (done) return;
    buffered += decoder.decode(value, { stream: true });
  }
}

/** Слушатель потока: обещание следующего звонка и способ закрыть поток. */
async function listen(person: Person): Promise<{
  status: number;
  nextNudge: () => Promise<string>;
  close: () => void;
}> {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/v1/stream`, {
    headers: { cookie: person.cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });

  const nudges = nudgesOf(response.body);

  return {
    status: response.status,
    nextNudge: async () => {
      const { value, done } = await nudges.next();
      if (done || value === undefined) throw new Error("поток закрылся, звонка не было");
      return value;
    },
    close: () => controller.abort(),
  };
}

describe("живые обновления", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  it("поток без сессии отвечает 401, а не пустым потоком", async () => {
    const response = await fetch(`${BASE}/v1/stream`, { headers: { accept: "text/event-stream" } });
    expect(response.status).toBe(401);
    // Тело обязано закрыться: висящий пустой поток неотличим от исправного.
    await response.text();
  });

  it("отправленное доезжает звонком через Caddy", async () => {
    const person = await newPerson("Слушатель");
    const stream = await listen(person);
    expect(stream.status).toBe(200);

    try {
      const nudge = stream.nextNudge();
      // Небольшая пауза: подписка должна встать до отправки, иначе звонок
      // уйдёт в пустоту и тест начнёт мигать.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await send(person, "первое живое");

      const got = await Promise.race([
        nudge,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("звонка не было 5 секунд")), 5000),
        ),
      ]);
      expect(got).toContain("event: changed");
    } finally {
      stream.close();
    }
  });

  it("после звонка догон отдаёт содержимое без дыр", async () => {
    const person = await newPerson("Догоняющий");
    const stream = await listen(person);

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      let cursor = 0;
      const seen: string[] = [];

      for (const text of ["раз", "два", "три"]) {
        const nudge = stream.nextNudge();
        await send(person, text);
        await Promise.race([
          nudge,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`звонка на «${text}» не было`)), 5000),
          ),
        ]);

        const sync = (await (
          await fetch(`${BASE}/v1/sync?after=${cursor}`, { headers: { cookie: person.cookie } })
        ).json()) as { messages: Array<{ body: string }>; seq: number };
        seen.push(...sync.messages.map((m) => m.body));
        cursor = sync.seq;
      }

      expect(seen).toEqual(["раз", "два", "три"]);
    } finally {
      stream.close();
    }
  });

  it("звонок чужого пространства до нас не доходит", async () => {
    const mine = await newPerson("Свой");
    const stranger = await newPerson("Чужой");
    const stream = await listen(mine);

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const nudge = stream.nextNudge();
      await send(stranger, "это не для тебя");

      const outcome = await Promise.race([
        nudge.then(() => "пришло"),
        new Promise<string>((resolve) => setTimeout(() => resolve("тишина"), 1500)),
      ]);
      expect(outcome).toBe("тишина");
    } finally {
      stream.close();
    }
  });
});
