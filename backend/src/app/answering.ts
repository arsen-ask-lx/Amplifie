import { buildPrompt, SYSTEM, type Turn } from "../agent/answering/prompt.js";
import { awaitsAnswer } from "../agent/listening/address.js";
import { NoBridgeError } from "../agent/model/bridge.js";
import { chooseProvider } from "../agent/model/choose.js";
import { ensureAgent } from "../kernel/identity/index.js";
import { listMessages, sendAsAgent, type Viewer } from "../kernel/talk/index.js";
import { askOwnBridge } from "./bridging.js";

/**
 * Агент отвечает в чате по обращению (task-006).
 *
 * ШОВ ПРОХОДИТ ЗДЕСЬ, а не внутри ядра: `talk` не знает про модель,
 * `agent/` не знает про хранилище, `identity` не знает, зачем ему агент.
 * Тот же приём, что в `listen.ts`.
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

/** Разговора не ждут ответа: обращения не было. */
export class NotAddressedError extends Error {}

/** Модель не подключена ничем: ни мостом, ни ключом сервера. */
export class ModelUnavailableError extends Error {}

export interface Answer {
  messageId: string;
  body: string;
  ms: number;
}

/** Спросить свой мост, а если его нет — провайдера из окружения сервера. */
async function ask(participantId: string, prompt: string): Promise<{ text: string; ms: number }> {
  try {
    return await askOwnBridge(participantId, prompt, SYSTEM);
  } catch (error) {
    if (!(error instanceof NoBridgeError)) throw error;

    // Моста нет — это не поломка, а обычное состояние: человек не подключал
    // свою подписку. Пробуем ключ сервера, если он настроен.
    const provider = chooseProvider(process.env);
    if (!provider) throw new ModelUnavailableError("ни моста, ни ключа");

    const started = Date.now();
    const answer = await provider.ask({ system: SYSTEM, prompt });
    return { text: answer.text, ms: Date.now() - started };
  }
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

  if (
    !awaitsAnswer(
      turns.map((one) => ({ body: one.body, authorKind: one.authorKind })),
      AGENT_NAME,
    )
  ) {
    throw new NotAddressedError();
  }

  const answer = await ask(viewer.participantId, buildPrompt(turns));

  const agent = await ensureAgent(viewer.workspaceId);

  // Ключ идемпотентности — идентификатор сообщения-обращения. Двойной зов
  // (двойной клик, повтор после разрыва) даёт один ответ, а не два.
  const asking = feed.items.at(-1);
  if (!asking) throw new NotAddressedError();

  const message = await sendAsAgent(viewer, agent.id, conversationId, {
    body: answer.text,
    clientMsgId: asking.id,
  });

  return { messageId: message.id, body: message.body, ms: answer.ms };
}
