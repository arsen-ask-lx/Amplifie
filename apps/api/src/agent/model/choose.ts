import {
  cliProvider,
  KNOWN_CLIENTS,
  type Provider,
  ProviderUnavailableError,
} from "@amplifie/model";
import { keyProvider } from "./http.js";

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

const KNOWN_API: Record<string, { url: string; dialect: "anthropic" | "openai"; model: string }> = {
  "anthropic-api": {
    url: "https://api.anthropic.com/v1/messages",
    dialect: "anthropic",
    model: "claude-sonnet-5",
  },
  "openai-api": {
    url: "https://api.openai.com/v1/responses",
    dialect: "openai",
    model: "gpt-5.4-mini",
  },
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

  const api = KNOWN_API[name];
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
