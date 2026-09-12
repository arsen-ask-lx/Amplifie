import {
  type Answer,
  type Ask,
  BadAnswerError,
  type Provider,
  ProviderUnavailableError,
} from "@amplifie/model";

/**
 * Ключ: обычный запрос к API (Р-012).
 *
 * Единственный законный путь, когда пространств больше одного и они чужие:
 * подписку перепродавать нельзя. Оплата по токенам, потолка нет.
 */

export interface KeyShape {
  name: string;
  /** Куда. Из настроек — чтобы работали и совместимые шлюзы. */
  url: string;
  /** Ключ. В логи не попадает никогда. */
  key: string;
  model: string;
  timeoutMs: number;
  /** Разный вид тела у разных поставщиков. */
  dialect: "anthropic" | "openai";
}

const MAX_OUTPUT_TOKENS = 1024;

/**
 * Куда и чем ходить к известным поставщикам.
 *
 * Живёт здесь, а не в `choose.ts`, потому что нужно двоим: серверу
 * с ключом из окружения и участнику с ключом из базы. Две копии этой
 * таблицы разъехались бы по адресу или по имени модели — и один из двоих
 * молча пошёл бы не туда.
 */
export const KNOWN_API: Record<
  string,
  { url: string; dialect: "anthropic" | "openai"; model: string }
> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    dialect: "anthropic",
    model: "claude-sonnet-5",
  },
  openai: {
    url: "https://api.openai.com/v1/responses",
    dialect: "openai",
    model: "gpt-5.4-mini",
  },
};

function bodyFor(shape: KeyShape, input: Ask): unknown {
  if (shape.dialect === "anthropic") {
    return {
      model: shape.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
    };
  }
  return {
    model: shape.model,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: input.system },
      { role: "user", content: input.prompt },
    ],
  };
}

function headersFor(shape: KeyShape): Record<string, string> {
  const common = { "content-type": "application/json" };
  return shape.dialect === "anthropic"
    ? { ...common, "x-api-key": shape.key, "anthropic-version": "2023-06-01" }
    : { ...common, authorization: `Bearer ${shape.key}` };
}

/** Достать текст из ответа. Форма разная, а нужен один и тот же кусок. */
function textOf(shape: KeyShape, payload: unknown): string {
  const body = payload as Record<string, unknown>;
  if (shape.dialect === "anthropic") {
    const blocks = (body.content ?? []) as Array<{ type?: string; text?: string }>;
    return blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
  }
  return String(body.output_text ?? "").trim();
}

export function keyProvider(shape: KeyShape): Provider {
  return {
    name: shape.name,
    billing: "api",

    async ask(input: Ask): Promise<Answer> {
      const stop = AbortSignal.timeout(shape.timeoutMs);
      let response: Response;
      try {
        response = await fetch(shape.url, {
          method: "POST",
          headers: headersFor(shape),
          body: JSON.stringify(bodyFor(shape, input)),
          signal: stop,
        });
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        // Ключ в сообщение не попадает: сообщения уходят в логи.
        throw new ProviderUnavailableError(`${shape.name}: запрос не ушёл — ${why}`);
      }

      if (!response.ok) {
        throw new ProviderUnavailableError(`${shape.name}: ответ ${response.status}`);
      }

      const text = textOf(shape, await response.json());
      if (!text) throw new BadAnswerError(`${shape.name}: пустой ответ`);
      return { text };
    },
  };
}
