import { useState } from "react";
import { api, type Me } from "../data/api.js";
import { describeFailure, type FormProblem } from "../shared/authMessages.js";
import { Field } from "../shared/Field.js";

type Mode = "login" | "register";

const EMPTY: FormProblem = { fields: {}, common: null };

interface Draft {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
}

const BLANK: Draft = { email: "", password: "", displayName: "", workspaceName: "" };

export function AuthScreen({ onEntered }: { onEntered: (me: Me) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [problem, setProblem] = useState<FormProblem>(EMPTY);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setProblem(EMPTY);
    try {
      onEntered(isRegister ? await api.register(draft) : await api.login(draft));
    } catch (error) {
      setProblem(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isRegister ? "login" : "register");
    setProblem(EMPTY);
  }

  return (
    <div className="screen">
      <form className="card" onSubmit={submit} noValidate>
        <h1>{isRegister ? "Создать пространство" : "Вход"}</h1>
        <p className="sub">
          {isRegister ? "Рабочее место, где агенты слышат разговор" : "Рады видеть снова"}
        </p>

        {problem.common ? <div className="err-top">{problem.common}</div> : null}

        <Field
          label="Почта"
          type="email"
          autoComplete="email"
          value={draft.email}
          onChange={set("email")}
          error={problem.fields.email}
        />
        <Field
          label="Пароль"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={draft.password}
          onChange={set("password")}
          error={problem.fields.password}
        />

        {isRegister ? (
          <>
            <Field
              label="Как вас зовут"
              autoComplete="name"
              value={draft.displayName}
              onChange={set("displayName")}
              error={problem.fields.displayName}
            />
            <Field
              label="Название пространства"
              value={draft.workspaceName}
              onChange={set("workspaceName")}
              error={problem.fields.workspaceName}
            />
          </>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? "Минуту…" : isRegister ? "Создать" : "Войти"}
        </button>

        <button type="button" className="link" onClick={switchMode}>
          {isRegister ? "У меня уже есть вход" : "Создать новое пространство"}
        </button>
      </form>
    </div>
  );
}
