import { useState } from "react";
import { api, type Me } from "./api.js";
import { describeFailure, type FormProblem } from "./authMessages.js";
import { Field } from "./Field.js";

/**
 * Вход по приглашению.
 *
 * Отдельный экран и отдельный вызов — не украшение, а требование Р-009:
 * путь входа по приглашению ровно один. Разбор чужой уязвимости показал,
 * что второй путь забывают проверить, и через него обходят доступ.
 *
 * Про негодное приглашение говорим одно и то же, каким бы негодным оно
 * ни было: просрочено, отозвано, уже использовано или выдумано. Разница
 * в ответах — это способ перебирать живые приглашения.
 */

const EMPTY: FormProblem = { fields: {}, common: null };

interface Draft {
  email: string;
  password: string;
  displayName: string;
}

const BLANK: Draft = { email: "", password: "", displayName: "" };

export function JoinScreen({ token, onEntered }: { token: string; onEntered: (me: Me) => void }) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [problem, setProblem] = useState<FormProblem>(EMPTY);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setProblem(EMPTY);
    try {
      onEntered(await api.join({ token, ...draft }));
    } catch (error) {
      setProblem(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <form className="card" onSubmit={submit} noValidate>
        <h1>Вас пригласили</h1>
        <p className="sub">Заведите вход — и попадёте в общее пространство</p>

        {problem.common ? <div className="err-top">{problem.common}</div> : null}

        <Field
          label="Как вас зовут"
          value={draft.displayName}
          onChange={set("displayName")}
          error={problem.fields.displayName}
        />
        <Field
          label="Почта"
          type="email"
          value={draft.email}
          onChange={set("email")}
          error={problem.fields.email}
        />
        <Field
          label="Пароль"
          type="password"
          value={draft.password}
          onChange={set("password")}
          error={problem.fields.password}
        />

        <button type="submit" disabled={busy}>
          {busy ? "Входим…" : "Войти в пространство"}
        </button>
      </form>
    </div>
  );
}
