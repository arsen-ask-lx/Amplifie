import { useState } from "react";
import { describeFailure, type FormProblem } from "../../shared/authMessages.js";

/**
 * Отправка формы двери: занятость и отказ.
 *
 * ⚠️ ОДНО МЕСТО, ПОТОМУ ЧТО ЗДЕСЬ ЛЕГКО ЗАБЫТЬ ОДНУ СТРОКУ ИЗ ПЯТИ.
 * Порядок обязателен и неочевиден: занять форму, стереть прошлый отказ,
 * попробовать, показать отказ словами, освободить форму — и последнее
 * ОБЯЗАТЕЛЬНО в `finally`. Пропусти его, и кнопка останется навсегда
 * выключенной после первой же неудачи: человек упёрся в «Минуту…»
 * и уходит.
 *
 * Отказ переводится на человеческий одним местом (`describeFailure`),
 * а не по месту вызова: иначе на одной двери скажут «неверный пароль»,
 * а на соседней покажут код ошибки.
 */

const БЕЗ_ОТКАЗА: FormProblem = { fields: {}, common: null };

export interface EntryForm {
  /** Идёт отправка — кнопку выключают, чтобы не нажали дважды. */
  busy: boolean;
  problem: FormProblem;
  /** Вешается на `onSubmit` формы: сам гасит перезагрузку страницы. */
  submit: (formEvent: React.FormEvent) => Promise<void>;
  /** Стереть отказ вручную — например, при переключении двери. */
  forget: () => void;
}

export function useEntryForm(отправить: () => Promise<void>): EntryForm {
  const [problem, setProblem] = useState<FormProblem>(БЕЗ_ОТКАЗА);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent): Promise<void> {
    formEvent.preventDefault();
    setBusy(true);
    setProblem(БЕЗ_ОТКАЗА);
    try {
      await отправить();
    } catch (error) {
      setProblem(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return { busy, problem, submit, forget: () => setProblem(БЕЗ_ОТКАЗА) };
}
