import { buildPrompt, SYSTEM, type Turn } from "../agent/answering/prompt.js";
import { awaitsAnswer } from "../agent/listening/address.js";
import { NoBridgeError } from "../agent/model/bridge.js";
import { chooseProvider } from "../agent/model/choose.js";
import { KNOWN_API, keyProvider } from "../agent/model/http.js";
import { ensureAgent, keyFor } from "../kernel/identity/index.js";
import { appendEvent } from "../kernel/journal/index.js";
import { listMessages, sendAsAgent, type Viewer } from "../kernel/talk/index.js";
import { db } from "../platform/db.js";
import { askOwnBridge } from "./bridging.js";

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

/** Имя участника-агента. Совпадает с тем, под которым его заводит identity. */
const AGENT_NAME = "Сводка";

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
async function sourcesFor(viewer: Viewer): Promise<Source[]> {
  const found: Source[] = [
    {
      payment: "мост",
      hint: null,
      ask: (prompt) => askOwnBridge(viewer.participantId, prompt, SYSTEM),
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
      ask: timed(async (prompt) => (await provider.ask({ system: SYSTEM, prompt })).text),
    });
  }

  const server = chooseProvider(process.env);
  if (server) {
    found.push({
      payment: "ключ сервера",
      hint: null,
      ask: timed(async (prompt) => (await server.ask({ system: SYSTEM, prompt })).text),
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
export async function answerIfAddressed(viewer: Viewer, conversationId: string): Promise<Answer> {
  // Видимость разговора проверяется здесь же: чужой разговор не читается,
  // и до модели дело не доходит.
  const feed = await listMessages(viewer, conversationId, WINDOW);

  const turns: Turn[] = feed.items.map((message) => ({
    body: message.body,
    authorName: message.author.name,
    authorKind: message.author.kind,
  }));

  const asking = feed.items.at(-1);
  const called = awaitsAnswer(
    turns.map((one) => ({ body: one.body, authorKind: one.authorKind })),
    AGENT_NAME,
  );
  if (!asking || !called) throw new NotAddressedError();

  const prompt = buildPrompt(turns);

  let answer: { text: string; ms: number; used: Source };
  try {
    answer = await askThrough(await sourcesFor(viewer), prompt);
  } catch (error) {
    await note(viewer, conversationId, "agent.refused", {
      reason: error instanceof Error ? error.constructor.name : "unknown",
    });
    throw error;
  }

  const agent = await ensureAgent(viewer.workspaceId);

  // Ключ идемпотентности — идентификатор сообщения-обращения. Двойной зов
  // (двойной клик, повтор после разрыва) даёт один ответ, а не два.
  const message = await sendAsAgent(viewer, agent.id, conversationId, {
    body: answer.text,
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
