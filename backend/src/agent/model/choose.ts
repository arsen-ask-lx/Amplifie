import {
  cliProvider,
  KNOWN_CLIENTS,
  type Provider,
  ProviderUnavailableError,
} from "@amplifie/model";
import { KNOWN_API, keyProvider } from "./http.js";

/**
 * Что настроено, то и берём (Р-012).
 *
 * Все значения — из окружения сервера. Ни одно не приходит из запроса,
 * из сообщения или из базы: `command` здесь — исполняемый файл, и данные
 * не должны иметь к нему доступа даже теоретически.
 */

const MINUTE = 60_000;

/**
 * Клиенты командной строки. Работают ТОЛЬКО там, где клиент установлен
 * и в него выполнен вход, — то есть не в контейнере сервера. Обычный путь
 * для подписки — мост на машине человека (task-001).
 */
const KNOWN_CLI = KNOWN_CLIENTS;

/**
 * Имена настройки → поставщик. Сама карта адресов общая (`http.ts`):
 * ходить к Anthropic из двух мест по двум разным адресам нельзя.
 */
const BY_SETTING: Record<string, keyof typeof KNOWN_API> = {
  "anthropic-api": "anthropic",
  "openai-api": "openai",
};

function number(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Провайдер по настройкам, либо null — если модель не подключена.
 *
 * null, а не исключение: «модель не подключена» — законное состояние.
 * Продукт работает и без неё, на правилах, и говорит об этом прямо.
 */
export function chooseProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  const name = env.AMPLIFIE_MODEL?.trim();
  if (!name) return null;

  const timeoutMs = number(env.AMPLIFIE_MODEL_TIMEOUT_MS, 2 * MINUTE);

  const cli = KNOWN_CLI[name];
  if (cli) {
    return cliProvider({
      name,
      // Путь можно переопределить: клиент бывает не в PATH службы.
      command: env.AMPLIFIE_MODEL_COMMAND?.trim() || cli.command,
      args: cli.args,
      timeoutMs,
    });
  }

  const api = KNOWN_API[BY_SETTING[name] ?? ""];
  if (api) {
    const key = env.AMPLIFIE_MODEL_KEY?.trim();
    if (!key) {
      throw new ProviderUnavailableError(
        `${name} требует ключ: задайте AMPLIFIE_MODEL_KEY. ` +
          "Подписочный токен сюда подставлять нельзя — это запрещено (Р-012).",
      );
    }
    return keyProvider({
      name,
      url: env.AMPLIFIE_MODEL_URL?.trim() || api.url,
      key,
      model: env.AMPLIFIE_MODEL_NAME?.trim() || api.model,
      dialect: api.dialect,
      timeoutMs,
    });
  }

  throw new ProviderUnavailableError(
    `неизвестный AMPLIFIE_MODEL=«${name}». Годятся: ${[
      ...Object.keys(KNOWN_CLI),
      ...Object.keys(KNOWN_API),
    ].join(", ")}`,
  );
}

export const KNOWN_PROVIDERS = [...Object.keys(KNOWN_CLI), ...Object.keys(KNOWN_API)];
