/**
 * ПРИЁМОЧНЫЙ ТЕСТ: изменение звонит соседям (Р-006; task-039, шаг 2).
 *
 * Звонок после фиксации — то, без чего новое появляется у соседа только
 * после перезагрузки. Прежде его ставили руками в каждой мутации, и заводка
 * ветки его забыла. Тест написан до правки и обязан быть красным.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, listen, newPerson, requireStand } from "./stand.js";

describe("изменение звонит соседям", () => {
  beforeAll(requireStand);

  it("новая ветка приходит к соседу звонком, без перезагрузки", async () => {
    const owner = await newPerson("Хозяин");
    const neighbour = await colleague(owner, "Сосед");

    const list = await call("GET", "/v1/conversations", owner);
    const channelId = ((await list.json()) as { items: { id: string }[] }).items[0]?.id;
    if (!channelId) throw new Error("у нового пространства нет канала");

    const ring = await listen(neighbour);
    const thread = await call("POST", `/v1/conversations/${channelId}/threads`, owner, {
      title: "Обсудить смету",
    });
    expect(thread.status).toBe(201);

    expect(await ring(), "ветка завелась, а сосед об этом не узнал").toBe(true);
  });
});
