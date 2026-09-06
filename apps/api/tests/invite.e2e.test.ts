/**
 * ПРИЁМОЧНЫЙ ТЕСТ ПРИГЛАШЕНИЙ (Р-009). Написан ДО кода и обязан быть красным.
 *
 * Каждая проверка ниже соответствует пункту списка «что обязано выполняться
 * всегда» из решения. Список не выдуман: он собран из опубликованного
 * разбора чужой уязвимости, где тот же токен, поданный через другой поток
 * входа, обходил проверку доступа.
 *
 * Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

/** Адрес только из латиницы: кириллица в локальной части не проходит проверку. */
function freshEmail(): string {
  return `inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("amplifie_session="));
  if (!header) throw new Error("сервер не выдал печеньку сессии");
  return header.split(";")[0] ?? "";
}

interface Owner {
  cookie: string;
  workspaceId: string;
}

async function newOwner(tag: string): Promise<Owner> {
  const response = await fetch(`${BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
      workspaceName: `Пространство ${tag}`,
    }),
  });
  if (response.status !== 201) throw new Error(`регистрация: ${response.status}`);
  const body = (await response.json()) as { workspace: { id: string } };
  return { cookie: sessionCookie(response), workspaceId: body.workspace.id };
}

/** Владелец выпускает приглашение. Сырой токен показывается один раз. */
async function invite(owner: Owner, options: object = {}): Promise<Response> {
  return fetch(`${BASE}/v1/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify(options),
  });
}

async function tokenOf(owner: Owner, options: object = {}): Promise<string> {
  const response = await invite(owner, options);
  if (response.status !== 201) throw new Error(`выпуск приглашения: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

/** Вход по приглашению — единственный путь присоединения. */
async function join(token: string, tag: string): Promise<Response> {
  return fetch(`${BASE}/v1/auth/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      email: freshEmail(),
      password: PASSWORD,
      displayName: tag,
    }),
  });
}

describe("приглашения", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`);
    if (!health.ok) throw new Error(`стек не поднят (${BASE}/health): make up`);
  });

  describe("① токен одноразовый", () => {
    it("первый вход удаётся, второй по тому же токену — нет", async () => {
      const owner = await newOwner("Хозяин");
      const token = await tokenOf(owner);

      const first = await join(token, "Первый");
      expect(first.status).toBe(201);

      const second = await join(token, "Второй");
      expect(second.status).toBe(404);
    });

    it("два устройства с одним токеном одновременно — входит ровно один", async () => {
      const owner = await newOwner("Гонка");
      const token = await tokenOf(owner);

      const both = await Promise.all([join(token, "Слева"), join(token, "Справа")]);
      const codes = both.map((r) => r.status).sort();

      // Один создан, второй получил отказ. Пятисотки быть не должно:
      // одновременность здесь — обычная работа, а не сбой.
      expect(codes).toEqual([201, 404]);
    });
  });

  describe("② срок и отзыв", () => {
    it("просроченное приглашение не принимается", async () => {
      const owner = await newOwner("Просрочка");
      // Срок настоящий и очень короткий — секунда. База не разрешает
      // приглашение, которое умерло раньше, чем родилось, и правильно
      // делает: проверять надо истечение времени, а не выдуманное прошлое.
      const token = await tokenOf(owner, { expiresInSeconds: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1400));

      const response = await join(token, "Опоздавший");
      expect(response.status).toBe(404);
    });

    it("отозванное приглашение не принимается", async () => {
      const owner = await newOwner("Отзыв");
      const created = await invite(owner);
      const body = (await created.json()) as { id: string; token: string };

      const revoked = await fetch(`${BASE}/v1/invites/${body.id}`, {
        method: "DELETE",
        headers: { cookie: owner.cookie },
      });
      expect(revoked.status).toBe(204);

      const response = await join(body.token, "Отозванный");
      expect(response.status).toBe(404);
    });
  });

  describe("③ по ответу нельзя перебирать", () => {
    it("выдуманный токен даёт тот же ответ, что и погашенный", async () => {
      const owner = await newOwner("Перебор");
      const token = await tokenOf(owner);
      await join(token, "Занявший");

      const spent = await join(token, "Повторный");
      const nonsense = await join("совершенно-выдуманный-токен", "Выдумщик");

      expect(spent.status).toBe(nonsense.status);
      expect(await spent.json()).toEqual(await nonsense.json());
    });

    it("чужой не может выпустить приглашение в чужое пространство", async () => {
      const stranger = await newOwner("Чужой");
      const response = await fetch(`${BASE}/v1/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(401);
      // Со своей сессией — можно, и это разные ответы.
      expect((await invite(stranger)).status).toBe(201);
    });
  });

  describe("④ регистрация приглашений не принимает НИКОГДА", () => {
    it("токен в теле register игнорируется и нового участника не создаёт", async () => {
      const owner = await newOwner("Обход");
      const token = await tokenOf(owner);

      const sneaky = await fetch(`${BASE}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: freshEmail(),
          password: PASSWORD,
          displayName: "Обходчик",
          workspaceName: "Своё",
          token,
        }),
      });
      expect(sneaky.status).toBe(201);

      // Он завёл СВОЁ пространство, а не попал в чужое.
      const body = (await sneaky.json()) as { workspace: { id: string } };
      expect(body.workspace.id).not.toBe(owner.workspaceId);

      // И приглашение осталось непогашенным — им ещё можно войти.
      expect((await join(token, "Честный")).status).toBe(201);
    });
  });

  describe("⑤ вошедший видит канал и не видит чужого", () => {
    it("приглашённый попадает в тот же канал, что и пригласивший", async () => {
      const owner = await newOwner("Пригласивший");
      const ownerRooms = (await (
        await fetch(`${BASE}/v1/conversations`, { headers: { cookie: owner.cookie } })
      ).json()) as { items: Array<{ id: string; title: string }> };

      const joined = await join(await tokenOf(owner), "Приглашённый");
      const guestCookie = sessionCookie(joined);

      const guestRooms = (await (
        await fetch(`${BASE}/v1/conversations`, { headers: { cookie: guestCookie } })
      ).json()) as { items: Array<{ id: string }> };

      expect(guestRooms.items.map((r) => r.id)).toEqual(ownerRooms.items.map((r) => r.id));
    });

    it("написанное одним видно другому в том же канале", async () => {
      const owner = await newOwner("Собеседник");
      const room = (
        (await (
          await fetch(`${BASE}/v1/conversations`, { headers: { cookie: owner.cookie } })
        ).json()) as { items: Array<{ id: string }> }
      ).items[0];
      if (!room) throw new Error("у владельца нет канала");

      const joined = await join(await tokenOf(owner), "Гость");
      const guestCookie = sessionCookie(joined);

      await fetch(`${BASE}/v1/conversations/${room.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: guestCookie },
        body: JSON.stringify({ body: "привет от гостя", clientMsgId: crypto.randomUUID() }),
      });

      const seen = (await (
        await fetch(`${BASE}/v1/conversations/${room.id}/messages`, {
          headers: { cookie: owner.cookie },
        })
      ).json()) as { items: Array<{ body: string; author: { name: string } }> };

      expect(seen.items.map((m) => m.body)).toContain("привет от гостя");
      expect(seen.items.at(-1)?.author.name).toBe("Гость");
    });
  });
});
