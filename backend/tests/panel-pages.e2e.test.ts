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
