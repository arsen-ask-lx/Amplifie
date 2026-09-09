import { fieldsOf, statusOf } from "./failure.js";
import { authTroubleOf } from "./trouble.js";

export interface FormProblem {
  fields: Record<string, string>;
  common: string | null;
}

const SAYS: Record<string, string> = {
  // Сервер намеренно не различает «нет такой почты» и «неверный пароль»:
  // иначе по ответу перебирают, кто зарегистрирован. Текст тоже общий.
  "не-та-пара": "Неверная почта или пароль",
  "ссылка-не-работает":
    "Ссылка-приглашение не работает: она уже использована, отозвана или устарела. Попросите новую.",
  // Р-024: одна установка — одна компания. Человеку важно не «нельзя»,
  // а что делать дальше: просить ссылку, а не подбирать пароль.
  "регистрация-закрыта":
    "На этом сервере пространство уже создано. Попросите ссылку-приглашение у того, кто его завёл.",
  "почта-занята": "Такая почта уже занята",
  "слишком-часто": "Слишком много попыток, подождите немного",
};

/** Превращает отказ сервера в то, что можно показать человеку. */
export function describeFailure(error: unknown): FormProblem {
  if (statusOf(error) === null) return { fields: {}, common: "Сервер недоступен" };

  const fields = fieldsOf(error);
  const known = SAYS[authTroubleOf(error)];
  if (known) return { fields, common: known };
  if (Object.keys(fields).length > 0) return { fields, common: null };
  return { fields, common: "Что-то пошло не так, попробуйте ещё раз" };
}
