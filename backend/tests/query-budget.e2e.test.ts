/**
 * ПРИЁМОЧНЫЙ ТЕСТ БЮДЖЕТА ЗАПРОСОВ (task-039, шаг 5): N+1 роняет проверку.
 * Написан ДО кода и обязан быть красным.
 *
 * N+1 — это когда число запросов к базе растёт вместе с числом строк:
 * список из тридцати чатов стоит тридцати одного запроса. На трёх
 * чатах этого не видно ничем, поэтому каждая дверь меряется дважды —
 * на малом и на большом объёме, — и счёт обязан совпасть.
 *
 * Счёт отдаёт стенд заголовком `x-db-queries` (в коробке его нет).
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, newPerson, type Person, requireStand } from "./stand.js";

async function queriesOf(response: Response): Promise<number> {
  const header = response.headers.get("x-db-queries");
  expect(header, "стенд не сказал, сколько было запросов к базе").not.toBeNull();
  await response.arrayBuffer();
  return Number(header);
}

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

/** Человек с `channels` чатами, `projects` проектами и `messages` репликами в первом чате. */
async function world(size: { channels: number; projects: number; messages: number }) {
  const person = await newPerson("Мерило");
  const channel = await firstChannel(person);
  for (let i = 0; i < size.projects; i++) {
    const project = await call("POST", "/v1/projects", person, { title: `Проект ${i}` });
    const { id } = (await project.json()) as { id: string };
    await call("POST", "/v1/conversations", person, { title: `В проекте ${i}`, projectId: id });
  }
  for (let i = 0; i < size.channels; i++) {
    await call("POST", "/v1/conversations", person, { title: `Чат ${i}` });
  }
  for (let i = 0; i < size.messages; i++) {
    await call("POST", `/v1/conversations/${channel}/messages`, person, {
      body: `реплика ${i}`,
      clientMsgId: crypto.randomUUID(),
    });
  }
  return { person, channel };
}

/** Дверь стоит одинаково на малом и большом объёме. */
async function sameCost(door: (w: Awaited<ReturnType<typeof world>>) => Promise<Response>) {
  const small = await world({ channels: 2, projects: 1, messages: 3 });
  const large = await world({ channels: 20, projects: 8, messages: 25 });
  const [atSmall, atLarge] = [
    await queriesOf(await door(small)),
    await queriesOf(await door(large)),
  ];
  expect(atLarge, `на большом объёме запросов больше (${atSmall} → ${atLarge}) — это N+1`).toBe(
    atSmall,
  );
}

describe("бюджет запросов к базе", () => {
  beforeAll(requireStand);

  it("панель стоит одинаково на двух и на двадцати чатах", async () => {
    await sameCost(({ person }) => call("GET", "/v1/conversations", person));
  });

  it("страница ленты стоит одинаково на трёх и на двадцати пяти репликах", async () => {
    await sameCost(({ person, channel }) =>
      call("GET", `/v1/conversations/${channel}/messages?limit=50`, person),
    );
  });

  it("догон стоит одинаково на малом и большом объёме", async () => {
    await sameCost(({ person }) => call("GET", "/v1/sync?after=0&limit=50", person));
  });

  it("отправка стоит одинаково в пустом и в живом чате", async () => {
    await sameCost(({ person, channel }) =>
      call("POST", `/v1/conversations/${channel}/messages`, person, {
        body: "замер",
        clientMsgId: crypto.randomUUID(),
      }),
    );
  });
});
