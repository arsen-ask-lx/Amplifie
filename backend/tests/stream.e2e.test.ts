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
import { BASE, call, requireStand, newPerson as standPerson } from "./stand.js";

interface Person {
  cookie: string;
  channelId: string;
}

/** Человек стенда и его первый канал: сюда и шлём. */
async function newPerson(tag: string): Promise<Person> {
  const person = await standPerson(tag);
  const list = await call("GET", "/v1/conversations", person);
  const items = ((await list.json()) as { items: Array<{ id: string }> }).items;
  const channelId = items[0]?.id;
  if (!channelId) throw new Error("у нового человека нет канала");
  return { cookie: person.cookie, channelId };
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

/**
 * Открыть поток, когда место освободилось. Закрытие доезжает до сервера
 * не мгновенно — ждём положительного признака, а не паузу наугад.
 */
async function openWhenFreed(person: Person): Promise<Awaited<ReturnType<typeof listen>> | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stream = await listen(person);
    if (stream.status === 200) return stream;
    stream.close();
  }
  return null;
}

describe("живые обновления", () => {
  beforeAll(requireStand);

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

  /**
   * task-093, слой 2: восемь вкладок человека после обрыва возвращаются,
   * не упираясь в порог. Расчёт в плане: восемь открытий и около 56 попыток
   * переподключения за минуту простоя — 64.
   */
  it("64 подключения одного человека за минуту — ни одного 429", async () => {
    const person = await newPerson("Восемь вкладок");
    const codes: number[] = [];
    for (let n = 0; n < 64; n++) {
      const stream = await listen(person);
      codes.push(stream.status);
      stream.close();
    }
    expect(
      codes.filter((one) => one === 429),
      "возвращение вкладок после выкладки упёрлось в порог",
    ).toHaveLength(0);
  });

  /**
   * task-093, слой 3: дорогой ресурс — одновременно открытые потоки,
   * а не частота попыток. Порог частоты их не держит: открытые живут часами.
   */
  it("17-й одновременный поток человека отклонён, после закрытия одного — снова можно", async () => {
    const person = await newPerson("Шестнадцать потоков");
    const open: Array<Awaited<ReturnType<typeof listen>>> = [];
    try {
      for (let n = 0; n < 16; n++) {
        const stream = await listen(person);
        open.push(stream);
        expect(stream.status, `поток №${n + 1} не открылся`).toBe(200);
      }

      const extra = await fetch(`${BASE}/v1/stream`, {
        headers: { cookie: person.cookie, accept: "text/event-stream" },
      });
      expect(extra.status, "семнадцатый одновременный поток открылся").toBe(429);
      // Открытый поток живёт часами: ждать предлагается полминуты, а не окно порога.
      expect(extra.headers.get("retry-after"), "не сказано, когда возвращаться").toBe("30");
      await extra.arrayBuffer();

      open.shift()?.close();
      const freed = await openWhenFreed(person);
      if (freed) open.push(freed);
      expect(freed?.status, "после закрытия потока место не освободилось").toBe(200);
    } finally {
      for (const stream of open) stream.close();
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

      // Положительный контроль: «тишина» проходит и на мёртвом потоке.
      // Своя реплика обязана дозвониться по тому же потоку — тот же ждущий звонок.
      await send(mine, "а это мне");
      const own = await Promise.race([
        nudge,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("поток молчит и о своём — тишина ничего не доказала")),
            5000,
          ),
        ),
      ]);
      expect(own).toContain("event: changed");
      expect(own, "звонок не назвал свой разговор").toContain(mine.channelId);
    } finally {
      stream.close();
    }
  });
});
