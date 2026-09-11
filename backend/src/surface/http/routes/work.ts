import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runTask } from "../../../app/working.js";
import {
  createTask,
  listParticipants,
  listTasks,
  patchTask,
  STAGES,
} from "../../../kernel/work/index.js";
import { parse } from "./parse.js";
import { actorOf } from "./viewer.js";

/** Ядро продукта наружу: разбор разговора, договорённости, задачи. */

const newTaskSchema = z.object({
  title: z.string().trim().min(1, "у задачи нужно название").max(200),
  responsibleId: z.uuid("нужен ответственный — и это человек"),
  assignedToId: z.uuid().nullable().optional(),
});

const patchTaskSchema = z
  .object({
    // Список стадий закрыт и здесь, и в базе. Два рубежа на одно правило —
    // осознанно: витрина обязана ответить человеку 422, а не пятисоткой,
    // но настоящий сторож всё равно в базе.
    stage: z.enum(STAGES).optional(),
    assignedToId: z.uuid().nullable().optional(),
    responsibleId: z.uuid().optional(),
  })
  .refine((one) => Object.keys(one).length > 0, "нечего менять");

export function registerWorkRoutes(app: FastifyInstance): void {
  app.get("/v1/tasks", async (request, _reply) => {
    const actor = actorOf(request);
    return { items: await listTasks(actor.workspaceId) };
  });

  /** Участники пространства: кого можно назначить исполнителем. */
  app.get("/v1/participants", async (request, _reply) => {
    const actor = actorOf(request);
    return { items: await listParticipants(actor.workspaceId) };
  });

  /** Завести задачу руками — без договорённости (task-010). */
  app.post("/v1/tasks", async (request, reply) => {
    const actor = actorOf(request);

    const input = parse(newTaskSchema, request.body, reply);
    if (!input) return reply;

    return reply.code(201).send(await createTask(actor, input));
  });

  /**
   * Пусть агент сделает задачу (task-011).
   *
   * ⚠️ Запускает ЧЕЛОВЕК и платит своей настройкой. Агент себя не
   * запускает: иначе доска стала бы счётчиком расходов, который никто
   * не заводил.
   */
  app.post<{ Params: { id: string } }>("/v1/tasks/:id/run", async (request, reply) => {
    const actor = actorOf(request);

    return reply.send(await runTask(actor, request.params.id));
  });

  /** Подвинуть по доске, назначить исполнителя, сменить ответственного. */
  app.patch<{ Params: { id: string } }>("/v1/tasks/:id", async (request, reply) => {
    const actor = actorOf(request);

    const input = parse(patchTaskSchema, request.body, reply);
    if (!input) return reply;

    return reply.send(await patchTask(actor, request.params.id, input));
  });
}
