/**
 * ПРИЁМОЧНЫЙ ТЕСТ: СОБЫТИЕ О РЕПЛИКЕ НЕСЁТ ПАПКУ (task-119, Д-65).
 *
 * Свёрнутая папка, чьих чатов вкладка не загружала, считает новое сама —
 * по полю `project` в событии. Папка — `projectId` самого разговора, как
 * у серверного счёта папки: у ветки поля нет, у чата вне папок — тоже.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, listenCalls, newPerson, type Person, requireStand } from "./stand.js";

async function made(person: Person, path: string, body: object): Promise<string> {
  const response = await call("POST", path, person, body);
  expect(response.status, path).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function say(person: Person, where: string, body: string): Promise<void> {
  const response = await call("POST", `/v1/conversations/${where}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status).toBe(201);
}

/** Первый звонок о нужном разговоре: звонки о заводке чатов пропускаем. */
async function callAbout(calls: Awaited<ReturnType<typeof listenCalls>>, where: string) {
  let seen = await calls.next();
  while (seen && seen.conversation !== where) seen = await calls.next();
  return seen;
}

describe("событие о реплике несёт папку", () => {
  beforeAll(requireStand);

  it("чат в папке — папка есть; вне папок и в ветке — поля нет", async () => {
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Коллега");
    const folder = await made(owner, "/v1/projects", { title: "Объект" });
    const inside = await made(owner, "/v1/conversations", { title: "Смета", projectId: folder });
    const loose = await made(owner, "/v1/conversations", { title: "Общее дело" });
    const branch = await made(owner, `/v1/conversations/${inside}/threads`, { title: "Ветка" });

    const calls = await listenCalls(mate);
    try {
      for (const [where, text] of [
        [inside, "в папке"],
        [loose, "вне папок"],
        [branch, "в ветке"],
      ] as const) {
        await say(owner, where, text);
        const seen = await callAbout(calls, where);
        expect(seen?.conversation, `нет звонка о реплике «${text}»`).toBe(where);
        if (where === inside) expect(seen?.project).toBe(folder);
        else expect(seen && "project" in seen, `у «${text}» папки быть не должно`).toBe(false);
      }
    } finally {
      calls.stop();
    }
  });
});
