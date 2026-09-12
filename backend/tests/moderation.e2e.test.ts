/**
 * ПРИЁМОЧНЫЙ ТЕСТ: кто удаляет чужое сообщение (Р-035, task-061).
 * Написан ДО кода и обязан быть красным.
 *
 * Чужое удаляет владелец канала (для ветки — корня) и владелец пространства;
 * чужое не правит никто. Для остальных чужое по-прежнему «нет такого» — 404.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

interface Said {
  id: string;
}

async function firstChannel(person: Person): Promise<string> {
  const list = (await (await call("GET", "/v1/conversations", person)).json()) as {
    items: { id: string }[];
  };
  const id = list.items[0]?.id;
  if (!id) throw new Error("в пространстве нет канала");
  return id;
}

async function say(person: Person, conversationId: string, body: string): Promise<string> {
  const response = await call("POST", `/v1/conversations/${conversationId}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status, `реплика «${body}» не ушла`).toBe(201);
  return ((await response.json()) as Said).id;
}

async function feedIds(person: Person, conversationId: string): Promise<string[]> {
  const response = await call("GET", `/v1/conversations/${conversationId}/messages`, person);
  return ((await response.json()) as { items: Said[] }).items.map((one) => one.id);
}

async function moderatorIn(person: Person, conversationId: string): Promise<boolean | undefined> {
  const list = (await (await call("GET", "/v1/conversations", person)).json()) as {
    items: { id: string; moderator?: boolean }[];
  };
  return list.items.find((one) => one.id === conversationId)?.moderator;
}

describe("удаление чужого (Р-035)", () => {
  beforeAll(requireStand);

  it("владелец канала удаляет реплику гостя — у гостя её больше нет", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const channel = await firstChannel(owner);
    const theirs = await say(guest, channel, "спам");

    expect((await call("DELETE", `/v1/messages/${theirs}`, owner)).status).toBe(204);
    expect(await feedIds(guest, channel)).not.toContain(theirs);
  });

  it("гость не удаляет реплику владельца — для него её «нет»", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const channel = await firstChannel(owner);
    const mine = await say(owner, channel, "моё");

    expect((await call("DELETE", `/v1/messages/${mine}`, guest)).status).toBe(404);
    expect(await feedIds(owner, channel)).toContain(mine);
  });

  it("владелец пространства удаляет в канале, который завёл другой", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const created = await call("POST", "/v1/conversations", guest, { title: "Гостевой" });
    expect(created.status).toBe(201);
    const channel = ((await created.json()) as Said).id;
    const theirs = await say(guest, channel, "в своём канале");

    expect((await call("DELETE", `/v1/messages/${theirs}`, owner)).status).toBe(204);
  });

  it("владелец канала удаляет и в его ветке — права ветки у корня", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const channel = await firstChannel(owner);
    const thread = await call("POST", `/v1/conversations/${channel}/threads`, owner, {
      title: "Ветка",
    });
    const threadId = ((await thread.json()) as Said).id;
    const theirs = await say(guest, threadId, "в ветке");

    expect((await call("DELETE", `/v1/messages/${theirs}`, owner)).status).toBe(204);
  });

  it("чужое не правит никто — даже владелец канала", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const channel = await firstChannel(owner);
    const theirs = await say(guest, channel, "как было");

    const edit = await call("PATCH", `/v1/messages/${theirs}`, owner, { body: "подмена" });
    expect(edit.status).toBe(404);
  });

  it("панель говорит, где человек может убирать чужое", async () => {
    const owner = await newPerson("Хозяин");
    const guest = await colleague(owner, "Гость");
    const channel = await firstChannel(owner);

    expect(await moderatorIn(owner, channel)).toBe(true);
    expect(await moderatorIn(guest, channel)).toBe(false);
  });
});
