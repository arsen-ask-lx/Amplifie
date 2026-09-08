import { useState } from "react";
import { api, type Me } from "../data/api.js";
import { describeFailure, type FormProblem } from "../shared/authMessages.js";
import { Field } from "../shared/Field.js";
import { Button } from "../shared/ui/button.js";

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
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <form
        className="w-full max-w-96 rounded-xl border border-line bg-card p-6 shadow-float"
        onSubmit={submit}
        noValidate
      >
        <h1 className="mb-1 font-serif text-brand leading-tight text-ink">
          {isRegister ? "Создать пространство" : "Вход"}
        </h1>
        <p className="mt-2 text-body leading-relaxed text-muted">
          {isRegister ? "Рабочее место, где агенты слышат разговор" : "Рады видеть снова"}
        </p>

        {problem.common ? (
          <div className="mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
            {problem.common}
          </div>
        ) : null}

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

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Минуту…" : isRegister ? "Создать" : "Войти"}
        </Button>

        <Button variant="link" onClick={switchMode}>
          {isRegister ? "У меня уже есть вход" : "Создать новое пространство"}
        </Button>
      </form>
    </div>
  );
}
