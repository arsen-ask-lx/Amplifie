import { useState } from "react";
import { api, type Me } from "../data/api.js";
import { describeFailure, type FormProblem } from "../shared/authMessages.js";
import { Field } from "../shared/Field.js";
import { Button } from "../shared/ui/button.js";
import { EntryFrame } from "./entry/EntryFrame.js";

/**
 * Вход по приглашению — ОТДЕЛЬНЫЙ экран, а не галочка на регистрации.
 *
 * ⚠️ РАЗДЕЛЕНИЕ ЗДЕСЬ НЕ РАДИ ВИДА. Класс уязвимости, ради которого
 * написано Р-009: тот же токен, поданный через ДРУГОЙ поток входа,
 * обходил проверку доступа. Ошибка была не в токене — в том, что путей
 * входа оказалось два. Один экран, умеющий и регистрацию, и вход
 * по ссылке, — это ровно тот второй путь, только нарисованный.
 *
 * Названия компании здесь нет намеренно: чтобы показать его до входа,
 * пришлось бы отвечать на запрос «а что за этой ссылкой» — и тогда
 * по ответу можно перебирать живые приглашения. Человек видит имя
 * компании сразу после входа, и этого достаточно.
 */

const EMPTY: FormProblem = { fields: {}, common: null };

export function JoinScreen({ token, onEntered }: { token: string; onEntered: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [problem, setProblem] = useState<FormProblem>(EMPTY);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setProblem(EMPTY);
    try {
      onEntered(await api.join({ token, email, password, displayName }));
    } catch (error) {
      setProblem(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntryFrame>
      <form onSubmit={submit} noValidate>
        <h1 className="mb-1 text-brand leading-tight text-ink">Вас пригласили</h1>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Заведите себе вход — и окажетесь в рабочем пространстве
        </p>

        {problem.common ? (
          <div className="mt-3 mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
            {problem.common}
          </div>
        ) : null}

        <div className="mt-4">
          <Field
            label="Почта"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            error={problem.fields.email}
          />
          <Field
            label="Пароль"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={problem.fields.password}
          />
          <Field
            label="Как вас зовут"
            autoComplete="name"
            value={displayName}
            onChange={setDisplayName}
            error={problem.fields.displayName}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Минуту…" : "Войти"}
        </Button>
      </form>
    </EntryFrame>
  );
}
