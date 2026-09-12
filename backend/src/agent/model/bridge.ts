import { type Answer, type Ask, type Provider, ProviderUnavailableError } from "@amplifie/model";
import { askBridge } from "../../platform/rendezvous.js";

/**
 * Провайдер «через мост участника» (task-001, Р-012).
 *
 * Модель спрашивает не наш сервер, а машина человека его же официальным
 * клиентом. Мы передаём туда текст вопроса и получаем текст ответа —
 * токена подписки не видим ни на одном шаге.
 *
 * Команду запуска клиента мы тоже не передаём: она берётся из настроек
 * НА МАШИНЕ человека. Иначе сервер диктовал бы чужой машине, что запускать,
 * и мост стал бы дырой размером с удалённое выполнение кода.
 */

/** Мост участника не подключён или сейчас не на связи. */
export class NoBridgeError extends ProviderUnavailableError {}

export function bridgeProvider(bridgeId: string, waitMs: number): Provider {
  return {
    name: "мост",
    billing: "subscription",

    async ask(input: Ask): Promise<Answer> {
      const text = await askBridge(
        bridgeId,
        { system: input.system, prompt: input.prompt },
        waitMs,
      );
      // Расход подписка не сообщает — и выдумывать его мы не будем.
      return { text };
    },
  };
}
