import { hasZodFastifySchemaValidationErrors } from "@fastify/type-provider-zod";
import type { FastifyError, FastifyInstance } from "fastify";
import { NoBridgeError } from "../../agent/model/bridge.js";
import { ModelUnavailableError } from "../../app/answering.js";
import {
  BadKeyFormatError,
  EmailTakenError,
  InvalidCredentialsError,
  InviteNotUsableError,
  NoSecretKeyError,
  RegistrationClosedError,
} from "../../kernel/identity/index.js";
import {
  ConversationNotVisibleError,
  MentionNotAllowedError,
  PinLimitError,
} from "../../kernel/talk/index.js";
import { BridgeFailedError, BridgeSilentError } from "../../platform/rendezvous.js";

/**
 * Отказ ядра → код ответа: одна таблица на все двери, чтобы слова ответа
 * не разъезжались. `detail` — показывать текст ошибки, только где он
 * понятен и не секретен. «Не видно» — всегда 404: 403 выдал бы существование.
 */
const KNOWN: ReadonlyArray<{
  kind: abstract new (...args: never[]) => Error;
  code: number;
  error: string;
  detail?: true;
}> = [
  { kind: ConversationNotVisibleError, code: 404, error: "not_found" },
  { kind: InviteNotUsableError, code: 404, error: "not_found" },
  { kind: MentionNotAllowedError, code: 422, error: "mention_not_allowed", detail: true },
  // Потолок закреплённого (Р-045): не ошибка человека, а правило чата — 409.
  { kind: PinLimitError, code: 409, error: "pin_limit" },
  { kind: BadKeyFormatError, code: 422, error: "bad_key_format", detail: true },
  { kind: EmailTakenError, code: 409, error: "email_taken" },
  { kind: InvalidCredentialsError, code: 401, error: "invalid_credentials" },
  { kind: RegistrationClosedError, code: 403, error: "registration_closed" },
  { kind: ModelUnavailableError, code: 503, error: "model_unavailable" },
  { kind: NoBridgeError, code: 503, error: "bridge_offline" },
  { kind: NoSecretKeyError, code: 503, error: "secrets_not_configured" },
  { kind: BridgeSilentError, code: 504, error: "model_silent", detail: true },
  { kind: BridgeFailedError, code: 502, error: "model_failed", detail: true },
];

/**
 * Ошибки схемы двери (Р-034) ПО ПОЛЯМ: клиент подсвечивает то поле, где
 * ошиблись, а не весь бланк. Первая ошибка на поле, а не все: человеку
 * нужна причина, а не перечень придирок.
 */
function fieldsOf(
  issues: ReadonlyArray<{ instancePath: string; message?: string | undefined }>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.instancePath.split("/").filter(Boolean).join(".") || "_";
    fields[key] ??= issue.message ?? "неверное значение";
  }
  return fields;
}

/** Ответ на отказ, который мы знаем, — либо `null`, если не знаем. */
function answerOf(error: unknown): { code: number; body: unknown } | null {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return { code: 422, body: { error: "validation_failed", fields: fieldsOf(error.validation) } };
  }
  const known = KNOWN.find((one) => error instanceof one.kind);
  if (known) {
    const message = (error as Error).message;
    return {
      code: known.code,
      body: known.detail ? { error: known.error, detail: message } : { error: known.error },
    };
  }
  // Порог частоты бросает не `Error`, а готовый ответ `{ statusCode: 429 }`:
  // отдаём его с его кодом, иначе он уезжал бы с кодом 200.
  if (!(error instanceof Error)) {
    const status = (error as { statusCode?: unknown }).statusCode;
    return { code: typeof status === "number" ? status : 500, body: error };
  }
  return null;
}

/**
 * Поставить общий перевод отказов. Свои ошибки разбора (4xx) Fastify
 * объясняет сам — в них нет ничего, кроме слов о форме запроса.
 *
 * ⚠️ НАСТОЯЩАЯ ПОЛОМКА — ОДНИМ СЛОВОМ, БЕЗ ТЕКСТА ОШИБКИ. Обработчик по
 * умолчанию отдавал `message` наружу, и Schemathesis (task-120) получил в
 * ответе 500 текст SQL-запроса с параметрами: имена таблиц и чужой ввод.
 * Подробности — в лог по идентификатору запроса, человеку — «внутренняя ошибка».
 */
export function answerKnownFailures(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const answer = answerOf(error);
    if (answer) return reply.code(answer.code).send(answer.body);
    if (error.statusCode !== undefined && error.statusCode < 500) throw error;
    request.log.error({ err: error }, "необработанная ошибка двери");
    return reply.code(500).send({ error: "internal_error" });
  });
}
