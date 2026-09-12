import { bridgeProvider, NoBridgeError } from "../agent/model/bridge.js";
import { listBridges } from "../kernel/identity/index.js";

/**
 * Спросить модель через СВОЙ мост (task-001).
 *
 * Шов проходит здесь: `kernel/identity` знает про мосты как про
 * удостоверения машин и ничего не знает про модель; `agent/model` знает
 * про модель и ничего — про то, чей это мост. Связывает их этот файл.
 */

const MINUTE = 60_000;

/**
 * Сколько ждём ответа моста. Настраивается, потому что цена ошибки разная:
 * на стенде долгое ожидание превращает прогон тестов в вечность, а живому
 * человеку лучше подождать, чем получить отказ на медленный, но идущий ответ.
 */
function waitMs(): number {
  const raw = Number(process.env.AMPLIFIE_BRIDGE_WAIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2 * MINUTE;
}

/** Постоянная часть подсказки для ПРОВЕРКИ СВЯЗИ. Короткая намеренно.
 * Разговор в чате передаёт свою — у него другая задача. */
const CHECK_SYSTEM =
  "Ты помощник в рабочем пространстве Amplifie. Отвечай коротко, по-русски, без вступлений.";

export async function askOwnBridge(
  participantId: string,
  prompt: string,
  system: string = CHECK_SYSTEM,
): Promise<{ text: string; ms: number }> {
  const mine = await listBridges(participantId);
  const online = mine.find((one) => one.online);
  if (!online) {
    // Обычное состояние, а не поломка: человек ещё не подключился либо
    // закрыл терминал. Отдельный тип ошибки — чтобы витрина сказала
    // «мост не на связи», а не «что-то пошло не так».
    throw new NoBridgeError("мост не на связи");
  }

  const started = Date.now();
  const answer = await bridgeProvider(online.id, waitMs()).ask({ system, prompt });
  return { text: answer.text, ms: Date.now() - started };
}
