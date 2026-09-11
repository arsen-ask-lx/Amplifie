import { readEnvelope } from "../agent/answering/envelope.js";
import { buildPrompt, SYSTEM, type Turn } from "../agent/answering/prompt.js";
import { awaitsAnswer } from "../agent/listening/address.js";
import { NoBridgeError } from "../agent/model/bridge.js";
import { chooseProvider } from "../agent/model/choose.js";
import { KNOWN_API, keyProvider } from "../agent/model/http.js";
import { AGENT_NAME, ensureAgent, keyFor } from "../kernel/identity/index.js";
import { appendEvent } from "../kernel/journal/index.js";
import {
  listMessages,
  type ScopeFeed,
  scopeFeed,
  sendAsAgent,
  type Viewer,
} from "../kernel/talk/index.js";
import { db } from "../platform/db.js";
import { askOwnBridge } from "./bridging.js";
import { doActions } from "./doing.js";

/**
 * Агент отвечает в чате по обращению (task-006), через настройку
 * спрашивающего (task-008).
 *
 * ШОВ ПРОХОДИТ ЗДЕСЬ, а не внутри ядра: `talk` не знает про модель,
 * `agent/` не знает про хранилище, `identity` не знает, зачем ему агент.
 *
 * ПОРЯДОК ВАЖЕН И ОН ДЕШЁВЫЙ СНАЧАЛА. Сперва читается лента и решается
 * за микросекунды, звали ли агента. Модель включается только на остатке.
 * Наоборот делать нельзя: вызов модели на каждое сообщение каждого канала
 * разоряет — к этому же выводу независимо пришёл Buzz.
 */

/** Сколько последних реплик читаем. Бюджет режет их дальше по объёму. */
const WINDOW = 100;

const MINUTE = 60_000;

/** Разговора не ждут ответа: обращения не было. */
export class NotAddressedError extends Error {}

/** Модель не подключена ничем: ни мостом, ни ключом. */
export class ModelUnavailableError extends Error {}

export interface Answer {
  messageId: string;
  body: string;
  ms: number;
}

/**
 * Чем именно платят за вызов. Едет в журнал и показывается человеку
 * в разделе «Агенты»: вопрос «чем я плачу» не должен требовать похода к нам.
 */
type Payment = "мост" | "свой ключ" | "ключ пространства" | "ключ сервера";

interface Source {
  payment: Payment;
  /** Последние знаки ключа. Не секрет — по ним нельзя вызвать модель. */
  hint: string | null;
  ask: (prompt: string) => Promise<{ text: string; ms: number }>;
}

/** Обернуть вызов так, чтобы он сам считал, сколько думал. */
function timed(ask: (prompt: string) => Promise<string>) {
  return async (prompt: string) => {
    const started = Date.now();
    return { text: await ask(prompt), ms: Date.now() - started };
  };
}

/**
 * Чем этот участник может спросить модель — по убыванию предпочтения.
 * Порядок из Р-016: свой мост → свой ключ → ключ пространства → ключ сервера.
 *
 * Мост раньше своего ключа не по прихоти: подписка уже оплачена помесячно,
 * а ключ считается по запросам. При прочих равных дешевле для человека тот,
 * за который он уже заплатил.
 *
 * Список, а не цепочка условий: добавить источник — значит вставить строку,
 * а не переписать ветвление.
 */
async function sourcesFor(viewer: Viewer, system: string = SYSTEM): Promise<Source[]> {
  const found: Source[] = [
    {
      payment: "мост",
      hint: null,
      ask: (prompt) => askOwnBridge(viewer.participantId, prompt, system),
    },
  ];

  const own = await keyFor(viewer);
  const api = own ? KNOWN_API[own.provider] : undefined;
  if (own && api) {
    const provider = keyProvider({
      name: own.provider,
      url: api.url,
      key: own.key,
      model: api.model,
      dialect: api.dialect,
      timeoutMs: 2 * MINUTE,
    });
    found.push({
      payment: own.scope === "участник" ? "свой ключ" : "ключ пространства",
      hint: own.hint,
      ask: timed(async (prompt) => (await provider.ask({ system, prompt })).text),
    });
  }

  const server = chooseProvider(process.env);
  if (server) {
    found.push({
      payment: "ключ сервера",
      hint: null,
      ask: timed(async (prompt) => (await server.ask({ system, prompt })).text),
    });
  }

  return found;
}

/**
 * Первый источник, который вообще существует прямо сейчас.
 *
 * Мост числится всегда, но может быть не подключён — это выясняется только
 * попыткой. Поэтому «нет моста» (`NoBridgeError`) ведёт к следующему,
 * а любой другой отказ пробрасывается: молча съесть отказ поставщика
 * значит потерять причину и показать человеку не то.
 */
/**
 * Спросить модель через настройку этого участника, с любой подсказкой.
 *
 * Вынесено наружу для прогона задач (task-011): порядок оплаты и обход
 * источников там ровно тот же, и вторая копия разъехалась бы с первой
 * при первом же изменении Р-016.
 */
export async function askThroughSources(
  viewer: Viewer,
  system: string,
  prompt: string,
): Promise<{ text: string; ms: number }> {
  const sources = await sourcesFor(viewer, system);
  const { text, ms } = await askThrough(sources, prompt);
  return { text, ms };
}

async function askThrough(
  sources: Source[],
  prompt: string,
): Promise<{ text: string; ms: number; used: Source }> {
  for (const [index, source] of sources.entries()) {
    const last = index === sources.length - 1;
    try {
      return { ...(await source.ask(prompt)), used: source };
    } catch (error) {
      if (!(error instanceof NoBridgeError)) throw error;
      if (last) throw new ModelUnavailableError("ни моста, ни ключа");
    }
  }
  throw new ModelUnavailableError("ни моста, ни ключа");
}

/** Что показать человеку: чем агент ответит, если позвать сейчас. */
export interface AnswersVia {
  kind: Payment | "нечем";
  hint: string | null;
}

export async function answersVia(viewer: Viewer): Promise<AnswersVia> {
  const sources = await sourcesFor(viewer);
  // Мост числится всегда, но сам по себе он ещё не способ ответить: пока
  // машина не на связи, за ним ничего нет, а состояние моста раздел
  // «Агенты» показывает отдельной строкой.
  const chosen = sources.find((one) => one.payment !== "мост");
  return chosen ? { kind: chosen.payment, hint: chosen.hint } : { kind: "нечем", hint: null };
}

/**
 * Разобрать разговор и, если агента звали, ответить в ту же ленту.
 *
 * Бросает `NotAddressedError`, если обращения не было: витрина превращает
 * это в 204, а не в ошибку. Отказ модели пробрасывается как есть —
 * и НЕ превращается в сообщение. Реплика «извините, ошибка» от имени
 * участника — это ложь про то, кто говорил; такому место в журнале,
 * а не в разговоре.
 */
/** Насколько широко агент читает, отвечая (Р-032). */
export type Scope = "conversation" | "project";

/**
 * Сколько строк области берём из базы.
 *
 * ⚠️ ЭТО ПОТОЛОК, А НЕ ПРЕДЕЛ. Настоящий предел — бюджет приглашения
 * в знаках (`prompt.ts`), и он общий на всю область: десять чатов стоят
 * столько же, сколько один. Число здесь нужно затем, чтобы ОДИН запрос
 * не вычитал проект целиком, если в нём миллион реплик.
 */
const SCOPE_LINES = 300;

/**
 * Сказать в ответе, по каким чатам агент смотрел.
 *
 * ⚠️ В САМОМ ОТВЕТЕ, А НЕ В СПРАВКЕ, И ЭТО СЛЕДСТВИЕ Р-032. Область
 * пересекается с правами позвавшего — значит двое, спросившие одно
 * и то же в одном канале, МОГУТ получить разные ответы. Неожиданность
 * тут дороже лишней строки: человек должен видеть, из чего сложен ответ,
 * а не гадать, почему у коллеги вышло иначе.
 */
function withScope(text: string, projectFeed: ScopeFeed | null): string {
  if (!projectFeed) return text;
  return `${text}

Смотрел: ${projectFeed.titles.join(", ")}.`;
}

export async function answerIfAddressed(
  viewer: Viewer & { kind: string },
  conversationId: string,
  scope: Scope = "conversation",
): Promise<Answer> {
  // Видимость разговора проверяется здесь же: чужой разговор не читается,
  // и до модели дело не доходит.
  const feed = await listMessages(viewer, conversationId, WINDOW);

  const turns: Turn[] = feed.items.map((message) => ({
    body: message.body,
    authorName: message.author.name,
    authorKind: message.author.kind,
  }));

  const asking = feed.items.at(-1);
  /**
   * ⚠️ АГЕНТ ЗАВОДИТСЯ ДО ПРОВЕРКИ ОБРАЩЕНИЯ, А НЕ ПОСЛЕ. Позвать его
   * можно и упоминанием — узлом с его номером (Р-031), — а номер надо
   * знать, чтобы узнать себя. Строка участника заводится один раз
   * на пространство и повторным вызовом не создаётся.
   */
  const agent = await ensureAgent(viewer.workspaceId);
  const called = awaitsAnswer(
    turns.map((one) => ({ body: one.body, authorKind: one.authorKind })),
    AGENT_NAME,
    agent.id,
  );
  if (!asking || !called) throw new NotAddressedError();

  /**
   * ⚠️ ОБЛАСТЬ РАСШИРЯЕТСЯ ПОСЛЕ ПРОВЕРКИ ОБРАЩЕНИЯ, А НЕ ДО. Обращение
   * ищется в ленте ТЕКУЩЕГО чата: расширив область раньше, мы стали бы
   * отвечать на «@memo», сказанное в соседнем канале час назад.
   *
   * Сама область — пересечение чатов проекта с тем, что видит позвавший
   * (Р-032). Пересечение считает ядро одним запросом; здесь его нельзя
   * ни расширить, ни обойти.
   */
  const projectFeed: ScopeFeed | null =
    scope === "project" ? await scopeFeed(viewer, conversationId, SCOPE_LINES) : null;
  const seen = projectFeed ? projectFeed.lines : turns;

  const prompt = buildPrompt(seen);

  let answer: { text: string; ms: number; used: Source };
  try {
    answer = await askThrough(await sourcesFor(viewer), prompt);
  } catch (error) {
    await note(viewer, conversationId, "agent.refused", {
      reason: error instanceof Error ? error.constructor.name : "unknown",
    });
    throw error;
  }

  // Конверт разбирается ЗДЕСЬ, после ответа модели и до записи в ленту.
  // Не разобрался — весь вывод считается простым ответом (Р-017).
  const envelope = readEnvelope(answer.text);

  // Действия выполняются ТОЛЬКО потому, что человек обратился: до этой
  // строки мы уже убедились в обращении (`called`). Ответственным становится
  // он же, и это не читается из вывода модели.
  const done = await doActions(viewer, agent.id, conversationId, envelope.actions);

  // Ключ идемпотентности — идентификатор сообщения-обращения. Двойной зов
  // (двойной клик, повтор после разрыва) даёт один ответ, а не два.
  const message = await sendAsAgent(viewer, agent.id, conversationId, {
    body: withScope(withReport(envelope.text, done), projectFeed),
    clientMsgId: asking.id,
  });

  // Кто спросил, чем заплатил, насколько большой был вопрос и сколько это
  // заняло. НИ ТЕКСТА ПОДСКАЗКИ, НИ ОТВЕТА, НИ КЛЮЧА: журнал живёт дольше
  // разговора и читается шире.
  await note(viewer, conversationId, "agent.asked", {
    payment: answer.used.payment,
    hint: answer.used.hint,
    promptChars: prompt.length,
    ms: answer.ms,
    made: done.made.length,
  });

  return { messageId: message.id, body: message.body, ms: answer.ms };
}

/** Запись в журнал о вызове модели. Одна форма на успех и на отказ. */
function note(
  viewer: Viewer,
  conversationId: string,
  kind: "agent.asked" | "agent.refused",
  payload: Record<string, unknown>,
): Promise<void> {
  return appendEvent(db, {
    kind,
    workspaceId: viewer.workspaceId,
    actorParticipantId: viewer.participantId,
    subjectType: "conversation",
    subjectId: conversationId,
    payload,
  });
}

/**
 * Приписать к ответу, что агент сделал.
 *
 * Обязательно, а не по вкусу: действие, о котором не сказали, неотличимо
 * от подлога (Р-017). Человек должен узнать о заведённой задаче из того же
 * сообщения, в котором получил ответ, — а не из раздела «Работа» через час.
 */
function withReport(text: string, done: { made: string[] }): string {
  if (done.made.length === 0) return text;
  const listed = done.made.map((one) => `«${one}»`).join(", ");
  const word = done.made.length === 1 ? "задачу" : "задачи";
  return `${text}

Завёл ${word}: ${listed}.`;
}
