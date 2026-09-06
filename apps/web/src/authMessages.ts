import { ApiError } from "./api.js";

export interface FormProblem {
  fields: Record<string, string>;
  common: string | null;
}

const BY_STATUS: Record<number, string> = {
  // Сервер намеренно не различает «нет такой почты» и «неверный пароль»:
  // иначе по ответу перебирают, кто зарегистрирован. Текст тоже общий.
  401: "Неверная почта или пароль",
  409: "Такая почта уже занята",
  429: "Слишком много попыток, подождите немного",
};

/** Превращает отказ сервера в то, что можно показать человеку. */
export function describeFailure(error: unknown): FormProblem {
  if (!(error instanceof ApiError)) return { fields: {}, common: "Сервер недоступен" };

  const fields = error.body.fields ?? {};
  const known = BY_STATUS[error.status];
  if (known) return { fields, common: known };
  if (Object.keys(fields).length > 0) return { fields, common: null };
  return { fields, common: "Что-то пошло не так, попробуйте ещё раз" };
}
