/**
 * Отказ сервера: как он выглядит и как из него достать что нужно.
 *
 * ЗДЕСЬ ТОЛЬКО МЕХАНИЗМ — форма ошибки и снятие с неё полей. Что означает
 * конкретный код на конкретной ручке, живёт рядом, в `trouble.ts`:
 * это разные вопросы, и смешивать их не надо.
 *
 * ⚠️ `ApiError` объявлен ЗДЕСЬ, а не в слое сети, хотя бросает его сеть.
 * Причина: `shared` не имеет права знать про остальные слои, а знать про
 * форму ошибки обязаны все. Поэтому объявление внизу, а бросок — выше.
 */

export interface FieldErrors {
  error: string;
  fields?: Record<string, string>;
  /** Подробность от сервера. Показывается только там, где она человеку понятна. */
  detail?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: FieldErrors,
    /** Сколько ждать по слову сервера (`Retry-After`), мс; 0 — не сказал. */
    readonly retryAfterMs = 0,
  ) {
    super(body.error);
  }
}

/**
 * Код ответа — или `null`, если до сервера вообще не дошли.
 *
 * ЕДИНСТВЕННОЕ МЕСТО, где читается `error.status`. До task-012 это делали
 * пять файлов, каждый по-своему, и один из способов уже врал.
 */
export function statusOf(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/**
 * Срок, названный сервером, в мс — или 0: не назвал или до сервера не дошли.
 * Единственное место, где его читают, как и `status` (task-111).
 */
export function retryAfterOf(error: unknown): number {
  return error instanceof ApiError ? error.retryAfterMs : 0;
}

/** Ошибки по полям формы. Пусто — значит сервер не разбирал поля. */
export function fieldsOf(error: unknown): Record<string, string> {
  return error instanceof ApiError ? (error.body.fields ?? {}) : {};
}

/**
 * Подробность от сервера.
 *
 * Показывается не везде: «мост ответил отказом: <текст клиента>» человеку
 * полезно, а внутренности разбора формы — нет. Решает вызывающий.
 */
export function detailOf(error: unknown): string | null {
  return error instanceof ApiError ? (error.body.detail ?? null) : null;
}
