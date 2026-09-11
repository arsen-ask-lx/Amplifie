import { useState } from "react";
import { api, type Me } from "../data/api.js";
import { Field } from "../shared/Field.js";
import { Button } from "../shared/ui/button.js";
import { Credentials } from "./entry/Credentials.js";
import { EntryFrame } from "./entry/EntryFrame.js";
import { EntryHead } from "./entry/EntryHead.js";
import { МОСТ } from "./entry/pictures.js";
import { useEntryForm } from "./entry/useEntryForm.js";

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

export function JoinScreen({ token, onEntered }: { token: string; onEntered: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { busy, problem, submit } = useEntryForm(async () => {
    onEntered(await api.join({ token, email, password, displayName }));
  });

  return (
    <EntryFrame picture={МОСТ}>
      <form onSubmit={submit} noValidate>
        <EntryHead
          title="Вас пригласили"
          subtitle="Заведите себе вход — и окажетесь в рабочем пространстве"
          trouble={problem.common}
        />

        <div>
          <Credentials
            email={email}
            password={password}
            onEmail={setEmail}
            onPassword={setPassword}
            problem={problem}
            newPassword
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
