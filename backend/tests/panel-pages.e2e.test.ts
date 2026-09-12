import { beforeAll, describe, expect, it } from "vitest";
import { call, colleague, newPerson, requireStand } from "./stand.js";

interface Project {
  id: string;
}

interface Chat {
  id: string;
  title: string;
}

async function project(owner: Awaited<ReturnType<typeof newPerson>>): Promise<Project> {
  const response = await call("POST", "/v1/projects", owner, { title: "Большой объект" });
  expect(response.status).toBe(201);
  return response.json() as Promise<Project>;
}

async function channel(
  owner: Awaited<ReturnType<typeof newPerson>>,
  projectId: string,
  title: string,
  visibility?: "private",
) {
  const response = await call(
    "POST",
    "/v1/conversations",
    owner,
    visibility ? { title, projectId, visibility } : { title, projectId },
  );
  expect(response.status).toBe(201);
}

describe("порции панели", () => {
  beforeAll(requireStand);

  it("проект отдаёт сначала десять чатов, затем следующую порцию по курсору", async () => {
    const owner = await newPerson("Порции");
    const folder = await project(owner);
    for (let number = 1; number <= 11; number += 1) {
      await channel(owner, folder.id, `Чат ${number}`);
    }

    const firstResponse = await call("GET", `/v1/projects/${folder.id}/conversations`, owner);
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as { items: Chat[]; next: string | null };
    expect(first.items).toHaveLength(10);
    expect(first.next, "после первых десяти нужен курсор следующей порции").not.toBeNull();

    const nextResponse = await call(
      "GET",
      `/v1/projects/${folder.id}/conversations?cursor=${encodeURIComponent(first.next ?? "")}`,
      owner,
    );
    expect(nextResponse.status).toBe(200);
    const next = (await nextResponse.json()) as { items: Chat[]; next: string | null };
    expect(next.items).toHaveLength(1);
    expect(new Set([...first.items, ...next.items].map((one) => one.id)).size).toBe(11);
    expect(next.next).toBeNull();
  });

  it("не раскрывает существование проекта, где человеку не виден ни один чат", async () => {
    const owner = await newPerson("Скрытая папка");
    const guest = await colleague(owner, "Гость");
    const folder = await project(owner);
    await channel(owner, folder.id, "Только владельцу", "private");

    const response = await call("GET", `/v1/projects/${folder.id}/conversations`, guest);
    expect(response.status).toBe(404);
  });
});

/**
 * Сводный ответ панели (task-064, шаг 3). Панель больше не тянет все чаты
 * пространства: проекты приходят со счётчиками, «Недавние» — первой порцией,
 * чаты проекта — только когда его раскрыли.
 */
describe("сводный ответ панели", () => {
  beforeAll(requireStand);

  it("отдаёт проекты со счётчиками и порцию «Недавних», а чаты проекта — нет", async () => {
    const owner = await newPerson("Сводка");
    const folder = await project(owner);
    await channel(owner, folder.id, "Внутри проекта");
    for (let number = 1; number <= 26; number += 1) {
      const made = await call("POST", "/v1/conversations", owner, { title: `Вне ${number}` });
      expect(made.status).toBe(201);
    }

    const response = await call("GET", "/v1/panel", owner);
    expect(response.status).toBe(200);
    const panel = (await response.json()) as {
      projects: Array<{ id: string; unread: number; mentions: number }>;
      recent: { items: Chat[]; next: string | null };
    };

    expect(panel.projects.map((one) => one.id)).toContain(folder.id);
    expect(panel.recent.items).toHaveLength(25);
    expect(panel.recent.next, "после первой порции нужен курсор").not.toBeNull();
    expect(
      panel.recent.items.map((one) => one.title),
      "чат проекта приехал в «Недавние» — панель снова тянет всё",
    ).not.toContain("Внутри проекта");
  });

  it("«Недавние» догружаются курсором и без дублей", async () => {
    const owner = await newPerson("Недавние");
    for (let number = 1; number <= 27; number += 1) {
      const made = await call("POST", "/v1/conversations", owner, { title: `Свежий ${number}` });
      expect(made.status).toBe(201);
    }

    const panel = (await (await call("GET", "/v1/panel", owner)).json()) as {
      recent: { items: Chat[]; next: string | null };
    };
    const more = await call(
      "GET",
      `/v1/conversations/recent?cursor=${encodeURIComponent(panel.recent.next ?? "")}`,
      owner,
    );
    expect(more.status).toBe(200);
    const rest = (await more.json()) as { items: Chat[]; next: string | null };

    const all = [...panel.recent.items, ...rest.items];
    expect(new Set(all.map((one) => one.id)).size, "порции налезли друг на друга").toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(28);
  });

  it("открытый чат приезжает строкой, даже если он внутри проекта", async () => {
    const owner = await newPerson("Открытый");
    const folder = await project(owner);
    const made = await call("POST", "/v1/conversations", owner, {
      title: "Смета",
      projectId: folder.id,
    });
    const open = (await made.json()) as Chat;

    const response = await call("GET", `/v1/panel?open=${open.id}`, owner);
    const panel = (await response.json()) as { open: Chat | null };
    expect(panel.open?.id, "лента не получит свою строку и покажет «Загружаем…»").toBe(open.id);
  });

  it("счёт проекта идёт по видимым чатам: чужой приватный в него не попадает", async () => {
    const owner = await newPerson("Счёт");
    const guest = await colleague(owner, "Гость");
    const folder = await project(owner);
    await channel(owner, folder.id, "Общий чат");
    await channel(owner, folder.id, "Только владельцу", "private");
    const list = (await (await call("GET", "/v1/conversations", owner)).json()) as {
      items: Chat[];
    };
    const secret = list.items.find((one) => one.title === "Только владельцу");
    if (!secret) throw new Error("приватный чат не завёлся");
    const said = await call("POST", `/v1/conversations/${secret.id}/messages`, owner, {
      body: "тайна",
      clientMsgId: crypto.randomUUID(),
    });
    expect(said.status).toBe(201);

    const response = await call("GET", "/v1/panel", guest);
    const panel = (await response.json()) as { projects: Array<{ id: string; unread: number }> };
    const seen = panel.projects.find((one) => one.id === folder.id);
    expect(seen?.unread, "счётчик выдал непрочитанное из чата, которого гость не видит").toBe(0);
  });
});
