import { PROJECT_COLORS, PROJECT_ICONS } from "@amplifie/contract";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { answerIfAddressed, NotAddressedError, type Scope } from "../../../app/answering.js";
import {
  createChannel,
  createProject,
  createThread,
  deleteConversation,
  deleteMessage,
  editMessage,
  listConversations,
  listMessages,
  listPinned,
  markRead,
  peopleToMention,
  pinMessage,
  removeProject,
  renameProject,
  sendMessage,
  setConversationPin,
  setProject,
  setProjectPin,
  sync,
  whereMentioned,
} from "../../../kernel/talk/index.js";
import { READ, SEND, SYNC } from "../limits.js";
import { parse } from "./parse.js";
import { actorOf } from "./viewer.js";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

const sendSchema = z.object({
  body: z.string().trim().min(1, "сообщение пустое").max(8000, "сообщение длиннее 8000 символов"),
  clientMsgId: z.uuid("нужен идентификатор, сгенерированный клиентом"),
  /** На что отвечаем. Проверку видимости делает ядро, а не эта схема. */
  replyToId: z.uuid().optional(),
  /** Откуда переслано. Та же проверка тем же местом. */
  forwardedFromId: z.uuid().optional(),
});

const editSchema = z.object({
  body: z.string().trim().min(1, "сообщение пустое").max(8000, "сообщение длиннее 8000 символов"),
});

/**
 * ⚠️ НОМЕР ЦЕЛЫЙ И НЕОТРИЦАТЕЛЬНЫЙ, БОЛЬШЕ ПРОВЕРЯТЬ НЕЧЕГО. «Номер
 * из будущего» отдельной ошибкой не делаем: он безобиден. Отметить
 * прочитанным то, чего ещё не написали, значит прочитать это вперёд —
 * а следующая реплика получит номер больше и станет непрочитанной как
 * положено. Проверка же «не больше последнего» стоила бы лишнего чтения
 * на каждую отметку ради предотвращения ничего.
 */
const readSchema = z.object({
  seq: z.int().min(0, "номер не бывает отрицательным"),
});

const channelSchema = z.object({
  title: z.string().trim().min(1, "у канала нужно название").max(120),
  /** Завести сразу внутри проекта (task-035): одним запросом. */
  projectId: z.string().uuid().optional(),
  // Приватный канал в интерфейсе пока не заводится, но чтение его уже
  // проверено тестом: поле не мёртвое, а опережающее (Р-010).
  visibility: z.enum(["workspace", "private"]).optional(),
});

/**
 * Проект: имя и вид (task-038).
 *
 * ⚠️ ЗНАЧОК И ЦВЕТ ПРОВЕРЯЮТСЯ ПО ОБЩЕМУ СПИСКУ, А НЕ ПО СВОЕЙ КОПИИ.
 * Список живёт в `packages/contract` — тот же, по которому фронт рисует
 * выбор. Заведи мы здесь второй, человек однажды выбрал бы значок,
 * которого сервер не знает.
 *
 * `null` значит «убрать вид», отсутствие поля — «не трогать»: это разные
 * вещи, и слить их значило бы стирать цвет при каждом переименовании.
 */
const projectSchema = z.object({
  title: z.string().trim().min(1, "у проекта нужно название").max(120),
  icon: z.enum(PROJECT_ICONS).nullable().optional(),
  color: z.enum(PROJECT_COLORS).nullable().optional(),
});

/** Правка проекта: имя необязательно — можно менять только вид. */
const projectPatchSchema = projectSchema.partial();

/**
 * Принадлежность чата проекту. `null` — снять и вернуть чат наружу.
 *
 * ⚠️ `nullable`, А НЕ `optional`, И РАЗНИЦА ЗДЕСЬ СМЫСЛОВАЯ. «Не указано»
 * означало бы «не трогай», а нам нужно уметь сказать «убери из проекта».
 * Слив их, снять принадлежность стало бы нечем.
 */
const moveSchema = z.object({
  projectId: z.string().uuid().nullable(),
});

/**
 * Насколько широко агент читает, отвечая (Р-032).
 *
 * По умолчанию — этот разговор: поведение до проектов сохраняется
 * в точности, и молчащий клиент ничего не теряет.
 */
const askSchema = z.object({
  scope: z.enum(["conversation", "project"]).optional(),
});

const threadSchema = z.object({
  title: z.string().trim().min(1, "у ветки нужно название").max(200),
});

function clampLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAGE;
  return Math.min(Math.trunc(value), MAX_PAGE);
}

/**
 * Позвать агента и превратить исход в ответ витрины.
 *
 * Вынесено из маршрута отдельной функцией не ради красоты: у маршрута
 * получалось три ветки поверх двух обёрток, и линтер сложности был прав —
 * такое читается только целиком.
 */
async function answerOrExplain(
  reply: FastifyReply,
  // `kind` нужен ядру работы: подтвердить договорённость может только
  // человек. Витрина не решает этого, она лишь честно передаёт, кто пришёл.
  viewer: { participantId: string; workspaceId: string; kind: string },
  conversationId: string,
  scope: Scope,
): Promise<FastifyReply> {
  try {
    return reply.code(201).send(await answerIfAddressed(viewer, conversationId, scope));
  } catch (error) {
    // Обращения не было — это не ошибка, а обычный ход событий: клиент
    // зовёт после каждой отправки и не обязан сам разбирать текст.
    if (error instanceof NotAddressedError) return reply.code(204).send();
    throw error;
  }
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.get("/v1/conversations", async (request) => {
    const viewer = actorOf(request);
    return listConversations(viewer);
  });

  /**
   * Отметить разговор прочитанным до номера включительно.
   *
   * ⚠️ «ДО НОМЕРА», А НЕ «ВОТ ЭТУ РЕПЛИКУ». Так у Телеграма
   * (`messages.readHistory peer max_id`), и так единственно верно:
   * человек читает подряд, а не выборочно, и отметка на каждой реплике
   * была бы записью того же факта сотней строк вместо одной.
   *
   * ⚠️ ОТВЕТ НЕСЁТ ОСТАТОК. Клиент видит только загруженный кусок ленты
   * и посчитать оставшееся сам не может — сервер видит всё. У них рядом
   * с номером едет `still_unread_count`, у нас то же самое.
   *
   * Повтор безобиден: номер двигается только вперёд, и вторая отметка
   * тем же числом не меняет ничего (Р-029).
   */
  app.post<{ Params: { id: string } }>(
    "/v1/conversations/:id/read",
    { config: { rateLimit: READ } },
    async (request, reply) => {
      const viewer = actorOf(request);

      const input = parse(readSchema, request.body, reply);
      if (!input) return reply;

      return markRead(viewer, request.params.id, input.seq);
    },
  );

  /**
   * Кого можно позвать в этом разговоре (Р-031).
   *
   * ⚠️ ВОПРОС ЗАДАН РАЗГОВОРУ, А НЕ ПРОСТРАНСТВУ. Список зависит от того,
   * кто ВИДИТ именно этот канал: в приватном звать некого, кроме его
   * участников. Общая дверь «кто есть в пространстве» отдала бы имена
   * тех, кого в приватном канале звать нельзя, — и подсказка предлагала
   * бы действие, которое сервер обязан отклонить.
   */
  app.get<{ Params: { id: string } }>("/v1/conversations/:id/people", async (request) => {
    const viewer = actorOf(request);
    return {
      items: await peopleToMention(viewer, request.params.id),
    };
  });

  /**
   * Где ближайшее неувиденное упоминание — куда ведёт кнопка перехода.
   *
   * Клиент сам ответить не может: он держит только окно ленты, а зов
   * может лежать за его краем. У Телеграма ровно по этой причине есть
   * `messages.getUnreadMentions`.
   */
  app.get<{ Params: { id: string } }>("/v1/conversations/:id/mention", async (request) => {
    const viewer = actorOf(request);
    return whereMentioned(viewer, request.params.id);
  });

  /**
   * Завести проект (Р-032). Прав проект не несёт, поэтому заводить его
   * может любой участник — как и канал.
   */
  app.post("/v1/projects", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(projectSchema, request.body, reply);
    if (!input) return reply;

    return reply.code(201).send(
      await createProject(viewer, {
        title: input.title,
        icon: input.icon ?? undefined,
        color: input.color ?? undefined,
      }),
    );
  });

  /** Переименовать проект. */
  app.patch<{ Params: { id: string } }>("/v1/projects/:id", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(projectPatchSchema, request.body, reply);
    if (!input) return reply;

    return renameProject(viewer, request.params.id, input);
  });

  /**
   * Убрать проект. Папка исчезает, переписка остаётся и возвращается
   * к чатам вне проектов (Р-032).
   */
  app.delete<{ Params: { id: string } }>("/v1/projects/:id", async (request, reply) => {
    const viewer = actorOf(request);

    await removeProject(viewer, request.params.id);
    return reply.code(204).send();
  });

  /**
   * Отнести чат к проекту либо снять принадлежность.
   *
   * PATCH, а не POST на отдельный путь: это правка свойства разговора,
   * такого же, как название, — а не отдельное действие над ним.
   */
  app.patch<{ Params: { id: string } }>("/v1/conversations/:id", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(moveSchema, request.body, reply);
    if (!input) return reply;

    return setProject(viewer, request.params.id, input.projectId);
  });

  app.post("/v1/conversations", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(channelSchema, request.body, reply);
    if (!input) return reply;

    const created = await createChannel(viewer, input);
    return reply.code(201).send({
      id: created.id,
      kind: created.kind,
      title: created.title,
      parentId: created.parentId,
      projectId: created.projectId,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/v1/conversations/:id/messages",
    async (request) => {
      const viewer = actorOf(request);
      // before — курсор листания назад. Мусор в нём означает «с конца»,
      // а не ошибку: сломанная ссылка не должна ронять экран.
      const before = Number(request.query.before);
      return listMessages(
        viewer,
        request.params.id,
        clampLimit(request.query.limit),
        Number.isFinite(before) && before > 0 ? before : undefined,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/conversations/:id/messages",
    { config: { rateLimit: SEND } },
    async (request, reply) => {
      const viewer = actorOf(request);

      const input = parse(sendSchema, request.body, reply);
      if (!input) return reply;

      const result = await sendMessage(viewer, request.params.id, input);
      // 200 на повтор, 201 на новое: клиент по коду понимает, что произошло,
      // а повтор после разрыва — нормальная работа, а не ошибка.
      return reply.code(result.replayed ? 200 : 201).send(result.message);
    },
  );

  /** Удалить канал. Чужое и несуществующее — оба 404: см. ядро. */
  app.delete<{ Params: { id: string } }>("/v1/conversations/:id", async (request, reply) => {
    await deleteConversation(actorOf(request), request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/v1/conversations/:id/threads", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(threadSchema, request.body, reply);
    if (!input) return reply;

    return reply.code(201).send(await createThread(viewer, request.params.id, input.title));
  });

  /**
   * Позвать агента разобрать разговор.
   *
   * ОТДЕЛЬНАЯ ДВЕРЬ, А НЕ ЧАСТЬ ОТПРАВКИ. Сообщение обязано записаться
   * мгновенно и не зависеть от модели: упавшая модель не должна означать
   * потерянную реплику. Поэтому клиент сперва отправляет, а потом зовёт.
   *
   * ⚠️ ЗОВЁТ КЛИЕНТ — значит закрытая вкладка равна отсутствию ответа.
   * Признано и записано в очередь работ. Лечится очередью, а её у нас нет
   * и заводить ради одного случая рано (task-006 §3).
   */
  app.post<{ Params: { id: string } }>("/v1/conversations/:id/ask", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(askSchema, request.body ?? {}, reply);
    if (!input) return reply;

    return answerOrExplain(reply, viewer, request.params.id, input.scope ?? "conversation");
  });

  /**
   * Закреплённое разговора. Отдельной дверью, а не полем в ленте: полоска
   * сверху нужна с первого кадра, а лента доезжает страницами.
   */
  app.get<{ Params: { id: string } }>("/v1/conversations/:id/pinned", async (request) => {
    const viewer = actorOf(request);
    return listPinned(viewer, request.params.id);
  });

  /**
   * Правка своей реплики.
   *
   * ⚠️ ЧУЖОЕ ОТВЕЧАЕТ 404, А НЕ 403. Отдельный ответ на «чужое» подтвердил
   * бы, что сообщение существует, — по нему перебираются чужие разговоры.
   * Рубеж «только своё» стоит в ядре, здесь только перевод отказа в код.
   */
  app.patch<{ Params: { id: string } }>("/v1/messages/:id", async (request, reply) => {
    const viewer = actorOf(request);

    const input = parse(editSchema, request.body, reply);
    if (!input) return reply;

    return reply.code(200).send(await editMessage(viewer, request.params.id, input.body));
  });

  app.delete<{ Params: { id: string } }>("/v1/messages/:id", async (request, reply) => {
    const viewer = actorOf(request);

    await deleteMessage(viewer, request.params.id);
    return reply.code(204).send();
  });

  /**
   * Закрепить разговор или проект в СВОЕЙ панели (task-038).
   *
   * ⚠️ ТОТ ЖЕ ВИД ДВЕРИ, ЧТО У ЗАКРЕПЛЁННОЙ РЕПЛИКИ: `POST` ставит,
   * `DELETE` снимает. Два разных закрепления — общее у реплики и личное
   * у списка, — но форма двери одна, и человеку, читающему маршруты,
   * не нужно держать в голове два способа сказать одно и то же.
   */
  app.post<{ Params: { id: string } }>("/v1/conversations/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await setConversationPin(viewer, request.params.id, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/v1/conversations/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await setConversationPin(viewer, request.params.id, false);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/v1/projects/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await setProjectPin(viewer, request.params.id, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/v1/projects/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await setProjectPin(viewer, request.params.id, false);
    return reply.code(204).send();
  });

  /**
   * Закрепить реплику для всех в разговоре. Две двери, а не одна с полем:
   * «закрепить» — не правка сообщения, и повтор у него безобиден.
   */
  app.post<{ Params: { id: string } }>("/v1/messages/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await pinMessage(viewer, request.params.id, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/v1/messages/:id/pin", async (request, reply) => {
    const viewer = actorOf(request);
    await pinMessage(viewer, request.params.id, false);
    return reply.code(204).send();
  });

  /**
   * Единственная дверь догона. И живое обновление, и восстановление после
   * разрыва идут одним кодом — Matrix пришёл к этому после болезненной
   * переделки, а не сразу.
   */
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    "/v1/sync",
    { config: { rateLimit: SYNC } },
    async (request) => {
      const viewer = actorOf(request);

      const after = Number(request.query.after ?? 0);
      return sync(
        viewer,
        Number.isFinite(after) && after > 0 ? after : 0,
        clampLimit(request.query.limit),
      );
    },
  );
}
