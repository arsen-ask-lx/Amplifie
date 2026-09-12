/**
 * ПРИЁМОЧНЫЙ ТЕСТ ДОГОНА ИЗМЕНЕНИЙ (change `chat-edit-delete-sync`).
 * Написан ДО кода и обязан быть красным.
 *
 * Свойство, ради которого всё делается: **изменение уже сказанной реплики
 * доезжает до вкладки, которая эту реплику уже получила**. Сегодня не
 * доезжает: догон отбирает по `message.seq`, а он выдаётся один раз при
 * вставке и правкой не двигается.
 *
 * ⚠️ ВТОРАЯ ВКЛАДКА — ЭТО ВТОРОЙ КУРСОР, А НЕ ВТОРОЙ ЧЕЛОВЕК. Приглашений
 * в продукте нет, второму человеку в пространство войти неоткуда
 * (см. `message-actions.e2e.test.ts`). Но догон устроен так, что курсор
 * принадлежит КЛИЕНТУ, а не учётной записи: две вкладки одного человека
 * догоняют независимо. Именно это здесь и проверяется, и именно это
 * ломалось на экране. Появится второй человек — свойство то же.
 *
 * ⚠️ ФАЙЛ ОТДЕЛЬНЫЙ, А НЕ ДОПИСАН В `stream.e2e.test.ts`. Тот проверяет
 * ЗВОНОК (доезжает ли событие через прокси), этот — СОДЕРЖИМОЕ ответа
 * догона. Разные свойства и разные причины падать; в одном файле
 * упавший звонок красил бы и проверки содержимого, а искать пришлось бы
 * дважды.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/**
 * Адрес для нового пространства.
 *
 * ⚠️ БЕЗ МЕТКИ ЧЕЛОВЕКА В АДРЕСЕ, И ЭТО НЕ МЕЛОЧЬ. Метки у нас русские
 * («Правящий», «Чужой»), а проверка адреса на сервере кириллицу в местной
 * части не принимает и отвечает 422. Первый прогон этих тестов упал именно
 * так — все семь разом и до всякой проверки свойства.
 */
function freshEmail(): string {
  return `sync-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Person {
  cookie: string;
  roomId: string;
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
  const roomId = items[0]?.id;
  if (!roomId) throw new Error("у нового пространства нет канала");
  return { cookie, roomId };
}

/** Как реплика выглядит в ответе догона. Надгробие — без текста. */
interface Line {
  id: string;
  seq: number;
  body?: string;
  deleted?: boolean;
  editedAt?: string | null;
  pinnedAt?: string | null;
  quote?: { body: string } | null;
}

async function send(person: Person, body: string): Promise<Line> {
  const response = await fetch(`${BASE}/v1/conversations/${person.roomId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify({ body, clientMsgId: crypto.randomUUID() }),
  });
  if (response.status !== 201) throw new Error(`отправка: ${response.status}`);
  return (await response.json()) as Line;
}

/**
 * Догон одной вкладки. Возвращает и строки, и новый курсор: без курсора
 * проверять нечего — половина свойств про него.
 */
async function syncFrom(
  cookie: string,
  cursor: number,
): Promise<{ lines: Line[]; cursor: number }> {
  const response = await fetch(`${BASE}/v1/sync?after=${cursor}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`догон: ${response.status}`);
  const body = (await response.json()) as { messages: Line[]; seq: number };
  return { lines: body.messages, cursor: body.seq };
}

/** Догнать до конца: вкладка, которая «уже всё видела». */
async function catchUp(cookie: string): Promise<number> {
  let cursor = 0;
  for (;;) {
    const got = await syncFrom(cookie, cursor);
    if (got.cursor === cursor) return cursor;
    cursor = got.cursor;
    if (got.lines.length === 0) return cursor;
  }
}

async function edit(person: Person, id: string, body: string): Promise<void> {
  const response = await fetch(`${BASE}/v1/messages/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify({ body }),
  });
  if (response.status !== 200) throw new Error(`правка: ${response.status}`);
}

async function remove(person: Person, id: string): Promise<void> {
  const response = await fetch(`${BASE}/v1/messages/${id}`, {
    method: "DELETE",
    headers: { cookie: person.cookie },
  });
  if (response.status !== 204) throw new Error(`удаление: ${response.status}`);
}

async function pin(person: Person, id: string, on: boolean): Promise<void> {
  const response = await fetch(`${BASE}/v1/messages/${id}/pin`, {
    method: on ? "POST" : "DELETE",
    headers: { cookie: person.cookie },
  });
  if (response.status !== 204) throw new Error(`закрепление: ${response.status}`);
}

/** Страница разговора вместе с головой пространства. */
async function roomPage(person: Person): Promise<{ items: Line[]; head: number }> {
  const response = await fetch(`${BASE}/v1/conversations/${person.roomId}/messages`, {
    headers: { cookie: person.cookie },
  });
  return (await response.json()) as { items: Line[]; head: number };
}

async function roomLines(person: Person): Promise<Line[]> {
  const response = await fetch(`${BASE}/v1/conversations/${person.roomId}/messages`, {
    headers: { cookie: person.cookie },
  });
  return ((await response.json()) as { items: Line[] }).items;
}

describe("догон отдаёт изменения", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  it("правка доезжает до второй вкладки", async () => {
    const person = await newPerson("Правящий");
    const said = await send(person, "первый вариант");

    // Вторая вкладка догнала до конца — реплика у неё уже есть.
    const cursor = await catchUp(person.cookie);

    await edit(person, said.id, "второй вариант");

    const got = await syncFrom(person.cookie, cursor);
    const line = got.lines.find((l) => l.id === said.id);
    expect(line).toBeDefined();
    expect(line?.body).toBe("второй вариант");
    expect(line?.editedAt).toBeTruthy();
  });

  it("догон не задваивает: два раза подряд без изменений — второй пустой", async () => {
    const person = await newPerson("Повторяющий");
    await send(person, "одна реплика");

    const cursor = await catchUp(person.cookie);
    const again = await syncFrom(person.cookie, cursor);

    expect(again.lines).toEqual([]);
    expect(again.cursor).toBe(cursor);
  });

  it("удаление приезжает надгробием без текста", async () => {
    const person = await newPerson("Удаляющий");
    const said = await send(person, "это исчезнет");
    const cursor = await catchUp(person.cookie);

    await remove(person, said.id);

    const got = await syncFrom(person.cookie, cursor);
    const line = got.lines.find((l) => l.id === said.id);
    expect(line).toBeDefined();
    expect(line?.deleted).toBe(true);
    // Не «пустая строка», а отсутствие поля: удаление означает, что текст
    // не отдаётся никому, включая тех, кто его уже видел.
    expect(line?.body).toBeUndefined();
    expect(line?.quote ?? null).toBeNull();
  });

  it("первичная загрузка не показывает ни реплики, ни надгробия", async () => {
    const person = await newPerson("Пришедший");
    const said = await send(person, "и следа не останется");
    await remove(person, said.id);

    const lines = await roomLines(person);
    expect(lines.some((l) => l.id === said.id)).toBe(false);
  });

  it("правка старой реплики не теряется за новыми", async () => {
    const person = await newPerson("Давний");
    const first = await send(person, "самая первая");
    for (let i = 0; i < 20; i++) await send(person, `следом ${i}`);

    const cursor = await catchUp(person.cookie);
    await edit(person, first.id, "исправленная первая");

    const got = await syncFrom(person.cookie, cursor);
    const line = got.lines.find((l) => l.id === first.id);
    expect(line?.body).toBe("исправленная первая");
    // Место в ленте не изменилось: правка двигает номер изменения,
    // а не номер, по которому реплика стоит в разговоре.
    expect(line?.seq).toBe(first.seq);
  });

  it("закрепление и открепление доезжают тем же догоном", async () => {
    const person = await newPerson("Закрепляющий");
    const said = await send(person, "важное");
    const cursor = await catchUp(person.cookie);

    await pin(person, said.id, true);
    const pinned = await syncFrom(person.cookie, cursor);
    expect(pinned.lines.find((l) => l.id === said.id)?.pinnedAt).toBeTruthy();

    await pin(person, said.id, false);
    const unpinned = await syncFrom(person.cookie, pinned.cursor);
    expect(unpinned.lines.find((l) => l.id === said.id)).toBeDefined();
    expect(unpinned.lines.find((l) => l.id === said.id)?.pinnedAt ?? null).toBeNull();
  });

  it("страница разговора называет голову пространства", async () => {
    // ⚠️ ЭТО ЛЕЧИТ Д-19. Свежая вкладка нигде не была, и догонять ей
    // нечего. Без этого числа начальный курсор брался из ленты открытой
    // комнаты: откроешь тихий канал — и каждая перезагрузка страницы
    // переигрывает историю пространства страницами по пятьдесят.
    const person = await newPerson("Свежий");
    const said = await send(person, "одна реплика");

    const page = await roomPage(person);
    expect(page.head).toBeGreaterThanOrEqual(said.seq);

    // Догон от головы обязан быть пустым: догонять нечего.
    const got = await syncFrom(person.cookie, page.head);
    expect(got.lines).toEqual([]);
    expect(got.cursor).toBe(page.head);
  });

  it("голова пространства не отстаёт от чужих разговоров", async () => {
    // Голова — про ПРОСТРАНСТВО, а не про комнату: реплика в соседнем
    // канале двигает её, даже если в открытом ничего не менялось.
    const person = await newPerson("Двухканальный");
    const first = await roomPage(person);

    const room = await fetch(`${BASE}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ title: "второй" }),
    });
    const second = ((await room.json()) as { id: string }).id;
    await fetch(`${BASE}/v1/conversations/${second}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ body: "в соседнем", clientMsgId: crypto.randomUUID() }),
    });

    const after = await roomPage(person);
    expect(after.head).toBeGreaterThan(first.head);
  });

  it("чужая переписка не просвечивает", async () => {
    const mine = await newPerson("Свой");
    const stranger = await newPerson("Чужой");

    const cursor = await catchUp(mine.cookie);
    const theirs = await send(stranger, "не для тебя");
    await edit(stranger, theirs.id, "и это тоже");

    const got = await syncFrom(mine.cookie, cursor);
    expect(got.lines).toEqual([]);
  });
});
