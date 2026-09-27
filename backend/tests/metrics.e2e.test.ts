/**
 * ПРИЁМОЧНЫЕ: ЧИСЛА ОТДАЁТ САМ СЕРВЕР (task-087).
 * Написаны ДО кода и обязаны быть красными.
 *
 * ⚠️ ГЛАВНАЯ ПРОВЕРКА ЗДЕСЬ — НЕ «ДВЕРЬ ОТВЕЧАЕТ», А «ЧИСЛА НЕ ВРУТ».
 * Измеритель этого проекта врал четыре раза за день, и каждый раз был
 * зелёным. Поэтому счётчик сервера сверяется с тем, что насчитал стенд
 * по заголовкам: два независимых свидетеля одного события.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, listenCalls, newPerson, type Person, requireStand } from "./stand.js";

/** Дверь метрик внутренняя: она живёт на порту api, а не за Caddy. */
const INSIDE = process.env.AMPLIFIE_API_URL ?? "http://localhost:3477";
const OUTSIDE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

async function metrics(): Promise<string> {
  const response = await fetch(`${INSIDE}/metrics`);
  expect(response.status, "дверь метрик").toBe(200);
  return response.text();
}

/** Значение числа по имени. Метки игнорируем — берём первое совпадение. */
function numberOf(text: string, name: string): number {
  const line = text.split("\n").find((one) => one.startsWith(name) && !one.startsWith("#"));
  // Строка формата Prometheus: имя ровно это (не длиннее), метки по желанию, число.
  expect(line, `в метриках нет числа ${name}`).toMatch(
    new RegExp(`^${name}(\\{[^}]*\\})? [0-9.eE+-]+$`, "u"),
  );
  return Number((line ?? "").trim().split(" ").at(-1));
}

async function firstChannel(person: Person): Promise<string> {
  const response = await call("GET", "/v1/conversations", person);
  const id = ((await response.json()) as { items: { id: string }[] }).items[0]?.id;
  if (!id) throw new Error("у нового пространства нет канала");
  return id;
}

describe("числа от самого сервера", () => {
  beforeAll(requireStand);

  it("отдаёт восемь чисел про себя", async () => {
    const text = await metrics();

    for (const name of [
      "amplifie_db_queries_total",
      "amplifie_tail_hits_total",
      "amplifie_tail_misses_total",
      "amplifie_events_total",
      "amplifie_streams",
      "amplifie_pool_busy",
      "amplifie_heap_bytes",
      "amplifie_event_loop_lag_seconds",
    ]) {
      expect(text, `метрика ${name}`).toContain(name);
    }
  });

  it("счётчик запросов к базе совпадает с тем, что насчитал сам запрос", async () => {
    // ⚠️ ЭТО И ЕСТЬ ВТОРОЙ СВИДЕТЕЛЬ. Заголовок `x-db-queries` считает
    // запросы ОДНОГО обращения, счётчик метрик — все подряд. Если они
    // разойдутся, врёт один из двух, и тогда все наши замеры под вопросом.
    const person = await newPerson("Мерило");
    const channel = await firstChannel(person);

    const before = numberOf(await metrics(), "amplifie_db_queries_total");
    const sent = await call("POST", `/v1/conversations/${channel}/messages`, person, {
      body: "сверка свидетелей",
      clientMsgId: crypto.randomUUID(),
    });
    const said = Number(sent.headers.get("x-db-queries") ?? 0);
    await sent.arrayBuffer();

    // Даём улечься тому, что отправка делает уже после ответа: адресаты
    // звонка читаются вне транзакции.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = numberOf(await metrics(), "amplifie_db_queries_total");

    expect(said, "заголовок насчитал запросы отправки").toBeGreaterThan(0);
    // Сервер видит и фоновые запросы, поэтому прирост не меньше — но
    // и не в разы больше: в тишине между двумя опросами больше нечему идти.
    expect(after - before, "счётчик сервера против заголовка").toBeGreaterThanOrEqual(said);
    expect(after - before, "счётчик сервера считает лишнее").toBeLessThan(said + 10);
  });

  it("здорового слушателя сервер не обрывает", async () => {
    // ⚠️ СТОРОЖ ОБРАТНОЙ СТОРОНЫ (Д-14). Предел незабранного буфера нужен,
    // чтобы один залипший не съел память процесса. Но ошибись он в другую
    // сторону — и сервер начнёт рвать живых, а те будут переподключаться
    // и догонять, то есть мы своими руками вернём то самое стадо.
    const owner = await newPerson("Хозяин");
    const mate = await colleague(owner, "Слушатель");
    const channel = await firstChannel(owner);

    const before = numberOf(await metrics(), "amplifie_streams_dropped_total");
    const stream = await listenCalls(mate);
    try {
      await call("POST", `/v1/conversations/${channel}/messages`, owner, {
        body: "обычная реплика обычному слушателю",
        clientMsgId: crypto.randomUUID(),
      });
      expect((await stream.next())?.conversation, "звонок дошёл").toBe(channel);
    } finally {
      stream.stop();
    }

    expect(
      numberOf(await metrics(), "amplifie_streams_dropped_total") - before,
      "того, кто читает, обрывать не за что",
    ).toBe(0);
  });

  it("снаружи дверь метрик не видна", async () => {
    // Caddy проксирует только /v1/* и /health; всё прочее уходит в статику.
    // Устройство внутренних чисел наружу не показывается вовсе.
    const response = await fetch(`${OUTSIDE}/metrics`);
    const text = await response.text();
    expect(text, "метрики просочились наружу").not.toContain("amplifie_db_queries_total");
    // Положительный контроль: внутри то же число есть — отказ выше не от того,
    // что метрика переименована.
    expect(await metrics()).toContain("amplifie_db_queries_total");
  });

  it("сама дверь метрик не ходит в базу", async () => {
    const response = await fetch(`${INSIDE}/metrics`);
    await response.text();
    // Заголовок ставится только на стенде; на нём и меряем.
    expect(
      Number(response.headers.get("x-db-queries") ?? 0),
      "опрос метрик обязан быть бесплатным для базы",
    ).toBe(0);
  });
});
