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
    const хозяин = await newPerson("Хозяин");
    const сосед = await colleague(хозяин, "Сосед");

    const список = await call("GET", "/v1/conversations", хозяин);
    const канал = ((await список.json()) as { items: { id: string }[] }).items[0]?.id;
    if (!канал) throw new Error("у нового пространства нет канала");

    const звонок = await listen(сосед);
    const ветка = await call("POST", `/v1/conversations/${канал}/threads`, хозяин, {
      title: "Обсудить смету",
    });
    expect(ветка.status).toBe(201);

    expect(await звонок(), "ветка завелась, а сосед об этом не узнал").toBe(true);
  });
});
