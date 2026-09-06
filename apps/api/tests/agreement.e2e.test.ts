/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЯДРА ПРОДУКТА — петли К1–К5.
 * Написан ДО кода и обязан быть красным.
 *
 * Это то, ради чего существует Amplifie: агент слышит разговор, отличает
 * договорённость от болтовни, формулирует её, человек подтверждает,
 * задача несёт с собой контекст.
 *
 * Проверяются свойства, названные в dock/04-каркас.md §4:
 *   ① подтвердить может ТОЛЬКО человек — гейт одобрения;
 *   ② договорённость без работы законна («решили не делать»);
 *   ③ человек подтверждает ТЕКСТ, который прочитал, а не машинный эффект;
 *   ④ у задачи есть цитата: настоящая ссылка на сообщение-источник,
 *      а не слепок. Без неё «долю выдуманного» не на чем считать.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `agr-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Stage {
  cookie: string;
  channelId: string;
}

async function stage(tag: string): Promise<Stage> {
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
  const channelId = ((await list.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  if (!channelId) throw new Error("у нового пространства нет канала");
  return { cookie, channelId };
}

async function say(place: Stage, body: string): Promise<{ id: string; seq: number }> {
  const response = await fetch(`${BASE}/v1/conversations/${place.channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: place.cookie },
    body: JSON.stringify({ body, clientMsgId: crypto.randomUUID() }),
  });
  return (await response.json()) as { id: string; seq: number };
}

/** Разбор разговора: агент читает и предлагает договорённости. */
async function listen(place: Stage): Promise<Response> {
  return fetch(`${BASE}/v1/conversations/${place.channelId}/listen`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: place.cookie },
    body: "{}",
  });
}

interface Agreement {
  id: string;
  text: string;
  status: string;
  conversationId: string;
  confirmedBy: string | null;
  citations: Array<{ messageId: string; quote: string }>;
}

async function agreements(place: Stage): Promise<Agreement[]> {
  const response = await fetch(`${BASE}/v1/agreements`, { headers: { cookie: place.cookie } });
  return ((await response.json()) as { items: Agreement[] }).items;
}

async function decide(place: Stage, id: string, verdict: "confirm" | "reject"): Promise<Response> {
  return fetch(`${BASE}/v1/agreements/${id}/${verdict}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: place.cookie },
    body: "{}",
  });
}

describe("ядро: договорённость", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("① агент слышит и предлагает", () => {
    it("на обязательство появляется предложенная договорённость", async () => {
      const place = await stage("Слушающий");
      await say(place, "Логи за август так и не выгружены.");
      const promise = await say(place, "Хорошо, я выгружу их к четвергу.");

      expect((await listen(place)).status).toBe(200);

      const found = await agreements(place);
      expect(found).toHaveLength(1);
      expect(found[0]?.status).toBe("proposed");
      // Цитата — настоящая ссылка на сообщение, а не слепок текста.
      expect(found[0]?.citations.map((c) => c.messageId)).toContain(promise.id);
    });

    it("на болтовню не появляется ничего", async () => {
      const place = await stage("Болтающий");
      await say(place, "Как выходные?");
      await say(place, "Отлично, ездили за город.");
      await say(place, "Кофемашина опять сломалась.");

      await listen(place);
      expect(await agreements(place)).toHaveLength(0);
    });

    it("повторный разбор не плодит одно и то же", async () => {
      const place = await stage("Повторный");
      await say(place, "Договорились: я пришлю смету в понедельник.");

      await listen(place);
      await listen(place);
      expect(await agreements(place)).toHaveLength(1);
    });
  });

  describe("② подтверждает только человек", () => {
    it("подтверждение переводит в confirmed и называет, кто подтвердил", async () => {
      const place = await stage("Подтверждающий");
      await say(place, "Беру на себя перенос базы, сделаю в выходные.");
      await listen(place);

      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");

      expect((await decide(place, proposal.id, "confirm")).status).toBe(200);

      const [after] = await agreements(place);
      expect(after?.status).toBe("confirmed");
      expect(after?.confirmedBy).not.toBeNull();
    });

    it("отклонение обратимо: отклонённое можно подтвердить", async () => {
      // Обратимость статусом, а не машинерией отмены (04-каркас §4).
      const place = await stage("Передумавший");
      await say(place, "Я подготовлю отчёт к пятнице.");
      await listen(place);

      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");

      await decide(place, proposal.id, "reject");
      expect((await agreements(place))[0]?.status).toBe("rejected");

      await decide(place, proposal.id, "confirm");
      expect((await agreements(place))[0]?.status).toBe("confirmed");
    });

    it("чужую договорённость не подтвердить", async () => {
      const place = await stage("Свой");
      await say(place, "Я закрою задачу по договору завтра.");
      await listen(place);
      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");

      const stranger = await stage("Чужой");
      expect((await decide(stranger, proposal.id, "confirm")).status).toBe(404);
    });
  });

  describe("③ задача несёт контекст", () => {
    it("подтверждённая договорённость даёт задачу с цитатой на источник", async () => {
      const place = await stage("Задачный");
      await say(place, "Нужно предупредить клиентов о простое.");
      const promise = await say(place, "Разошлю письмо сегодня, шаблон уже есть.");
      await listen(place);

      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");
      await decide(place, proposal.id, "confirm");

      const tasks = (await (
        await fetch(`${BASE}/v1/tasks`, { headers: { cookie: place.cookie } })
      ).json()) as {
        items: Array<{
          id: string;
          title: string;
          agreementId: string;
          citations: Array<{ messageId: string; quote: string }>;
        }>;
      };

      expect(tasks.items).toHaveLength(1);
      const task = tasks.items[0];
      expect(task?.agreementId).toBe(proposal.id);
      // К5: по задаче можно дойти до реплики, из которой она родилась.
      expect(task?.citations.map((c) => c.messageId)).toContain(promise.id);
      expect(task?.citations[0]?.quote.length).toBeGreaterThan(0);
    });

    it("отклонённая договорённость задачи не порождает", async () => {
      const place = await stage("Отклонённый");
      await say(place, "Я обновлю сертификаты до конца месяца.");
      await listen(place);
      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");

      await decide(place, proposal.id, "reject");

      const tasks = (await (
        await fetch(`${BASE}/v1/tasks`, { headers: { cookie: place.cookie } })
      ).json()) as { items: unknown[] };
      expect(tasks.items).toHaveLength(0);
    });

    it("повторное подтверждение не плодит вторую задачу", async () => {
      const place = await stage("Дважды");
      await say(place, "Я согласую документ до конца недели.");
      await listen(place);
      const [proposal] = await agreements(place);
      if (!proposal) throw new Error("агент ничего не предложил");

      await decide(place, proposal.id, "confirm");
      await decide(place, proposal.id, "confirm");

      const tasks = (await (
        await fetch(`${BASE}/v1/tasks`, { headers: { cookie: place.cookie } })
      ).json()) as { items: unknown[] };
      expect(tasks.items).toHaveLength(1);
    });
  });
});
