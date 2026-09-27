/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПОРЯДКА В ПАНЕЛИ (Д-30, task-036).
 *
 * ⚠️ ЭТО СТОРОЖ НА СМЫСЛ, А НЕ НА СКОРОСТЬ. Задача, ради которой он
 * написан, — ускорение: свежесть канала перестаёт считаться обходом всей
 * его переписки. Скорость проверяется ЗАМЕРОМ в логе задачи, а не здесь:
 * тест на время краснеет от нагрузки соседнего процесса и превращается
 * в мигающий, а мигающий тест хуже отсутствующего.
 *
 * Здесь проверяется единственное, что ускорение может испортить, —
 * ПОРЯДОК каналов. Его человек видит сразу, и врёт он молча.
 *
 * ⚠️ ВТОРОЙ СЛУЧАЙ ВАЖНЕЕ ПЕРВОГО. «Свежесть» и «когда в последний раз
 * менялось» — разные вещи: правка старой реплики двигает номер изменения
 * (Р-021), но НЕ должна поднимать канал наверх, иначе исправленная
 * опечатка недельной давности вытолкнет сегодняшний разговор.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, type Person, requireStand } from "./stand.js";

async function newChannel(person: Person, title: string): Promise<string> {
  const response = await call("POST", "/v1/conversations", person, { title });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function say(person: Person, conversationId: string, body: string): Promise<string> {
  const response = await call("POST", `/v1/conversations/${conversationId}/messages`, person, {
    body,
    clientMsgId: crypto.randomUUID(),
  });
  expect(response.status, `реплика «${body}» не отправилась`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Закрепить разговор в СВОЕЙ панели либо снять закрепление (task-038). */
function pin(person: Person, conversationId: string, on: boolean): Promise<Response> {
  return call(on ? "POST" : "DELETE", `/v1/conversations/${conversationId}/pin`, person);
}

/** Названия каналов в том порядке, в каком их показывает панель. */
async function order(person: Person): Promise<string[]> {
  const response = await call("GET", "/v1/conversations", person);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: { title: string }[] };
  return body.items.map((one) => one.title);
}

describe("порядок каналов в панели", () => {
  beforeAll(requireStand);

  it("канал, в котором сказали позже, стоит выше", async () => {
    const person = await newPerson("Смотрящий");
    const first = await newChannel(person, "Первый");
    const second = await newChannel(person, "Второй");
    const third = await newChannel(person, "Третий");

    await say(person, second, "во втором");
    await say(person, third, "в третьем");
    await say(person, first, "в первом");

    const list = await order(person);
    expect(list.slice(0, 3), "панель сортирует не по свежести разговора").toEqual([
      "Первый",
      "Третий",
      "Второй",
    ]);
  });

  /**
   * ЗАКРЕПЛЕНИЕ (task-038, Д-32 закрыт владельцем: закрепление ЛИЧНОЕ).
   *
   * ⚠️ ПОРЯДОК СЧИТАЕТ СЕРВЕР, И ЗАКРЕПЛЁННОЕ ПОДНИМАЕТ ТОЖЕ ОН. Сделай
   * это клиент — про порядок знали бы двое, и однажды они разошлись бы:
   * у одного закреплённое сверху, у другого нет.
   */
  it("закреплённый канал стоит выше свежего", async () => {
    const person = await newPerson("Смотрящий");
    const quiet = await newChannel(person, "Редкий");
    const fresh = await newChannel(person, "Свежий");

    await say(person, quiet, "давно");
    await say(person, fresh, "только что");
    expect((await order(person)).slice(0, 2)).toEqual(["Свежий", "Редкий"]);

    expect((await pin(person, quiet, true)).status).toBe(204);
    expect(
      (await order(person)).slice(0, 2),
      "закреплённый канал не поднялся — закреплять его тогда незачем",
    ).toEqual(["Редкий", "Свежий"]);

    expect((await pin(person, quiet, false)).status).toBe(204);
    expect((await order(person)).slice(0, 2), "снятое закрепление не отпустило").toEqual([
      "Свежий",
      "Редкий",
    ]);
  });

  it("закрепление личное: у коллеги порядок свой", async () => {
    const owner = await newPerson("Смотрящий");
    const quiet = await newChannel(owner, "Редкий");
    const fresh = await newChannel(owner, "Свежий");
    await say(owner, quiet, "давно");
    await say(owner, fresh, "только что");

    const mate = await colleague(owner, "Коллега");
    expect((await pin(owner, quiet, true)).status).toBe(204);

    expect((await order(owner)).slice(0, 2)).toEqual(["Редкий", "Свежий"]);
    expect(
      (await order(mate)).slice(0, 2),
      "моё закрепление переставило панель коллеге — это его взгляд, не мой",
    ).toEqual(["Свежий", "Редкий"]);
  });

  it("закрепить дважды — тот же исход, а не ошибка", async () => {
    const person = await newPerson("Смотрящий");
    const channel = await newChannel(person, "Дважды");
    const fresh = await newChannel(person, "Свежий");
    await say(person, channel, "давно");
    await say(person, fresh, "только что");

    expect((await pin(person, channel, true)).status).toBe(204);
    expect(
      (await pin(person, channel, true)).status,
      "повтор закрепления отвечает ошибкой — а он ничего не меняет",
    ).toBe(204);
    // Исход, а не только код: после двойного закрепления порядок верен,
    // и снятие закрепления его по-прежнему отпускает. Сколько строк завёл
    // повтор, отсюда не видно: снятие убирает все строки пары.
    expect((await order(person)).slice(0, 2), "дважды закреплённый не наверху").toEqual([
      "Дважды",
      "Свежий",
    ]);
    expect((await pin(person, channel, false)).status).toBe(204);
    expect(
      (await order(person)).slice(0, 2),
      "снятие после двойного закрепления не отпустило",
    ).toEqual(["Свежий", "Дважды"]);
  });

  it("чужой разговор закрепить нельзя", async () => {
    const owner = await newPerson("Смотрящий");
    const stranger = await newPerson("Чужой");
    const channel = await newChannel(owner, "Не твой");

    expect(
      (await pin(stranger, channel, true)).status,
      "закрепили разговор, которого не видно: панель рассказала бы о нём",
    ).toBe(404);
  });

  it("правка старой реплики не поднимает канал наверх", async () => {
    const person = await newPerson("Смотрящий");
    const old = await newChannel(person, "Старый");
    const fresh = await newChannel(person, "Свежий");

    const oldMessage = await say(person, old, "давняя реплика");
    await say(person, fresh, "сегодняшняя реплика");
    expect((await order(person)).slice(0, 2)).toEqual(["Свежий", "Старый"]);

    // Правка двигает номер ИЗМЕНЕНИЯ (Р-021) — по нему живёт догон.
    // Место в списке живёт по другому вопросу: когда тут говорили.
    const edit = await call("PATCH", `/v1/messages/${oldMessage}`, person, {
      body: "давняя реплика, исправленная",
    });
    expect(edit.status).toBe(200);

    expect(
      (await order(person)).slice(0, 2),
      "исправленная опечатка недельной давности вытолкнула сегодняшний разговор",
    ).toEqual(["Свежий", "Старый"]);
  });
});
