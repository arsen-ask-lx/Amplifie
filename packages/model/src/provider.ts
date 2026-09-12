/**
 * Один интерфейс к модели. Всё, что о ней знает остальной код.
 *
 * Намеренно узкий: спросить текстом — получить текст. Ни потоков, ни
 * инструментов, ни истории. Расширять можно, сузить обратно — нет,
 * потому что за широкий интерфейс сразу цепляются.
 */

export interface Ask {
  /** Постоянная часть: кто ты и что делаешь. */
  system: string;
  /** Переменная часть: сам разговор. */
  prompt: string;
}

export interface Answer {
  text: string;
  /** Сколько это стоило, если провайдер сказал. Подписка обычно молчит. */
  spent?: { inputTokens: number; outputTokens: number } | undefined;
}

export interface Provider {
  /** Как называть в логах и в `make model`. */
  readonly name: string;
  /** Подписка или ключ — важно для отчётности и для границ Р-012. */
  readonly billing: "subscription" | "api";
  ask(input: Ask): Promise<Answer>;
}

/** Провайдер настроен неверно либо недоступен. Отличается от ошибки модели. */
export class ProviderUnavailableError extends Error {}

/** Модель ответила, но ответ негоден: пусто, обрыв, не тот вид. */
export class BadAnswerError extends Error {}
