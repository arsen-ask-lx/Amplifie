import type { FormProblem } from "../../shared/authMessages.js";
import { Field } from "../../shared/Field.js";

/**
 * Почта и пароль — два поля, одинаковые на всех дверях.
 *
 * ⚠️ ВЫНЕСЕНО, ПОТОМУ ЧТО ЭТО ОДНО ЗНАНИЕ, А НЕ ДВА ПОХОЖИХ КУСКА
 * РАЗМЕТКИ. У экрана входа и у экрана приглашения совпадало всё: типы
 * полей, подсказки браузеру (`autoComplete`), имена, привязка ошибок.
 * Гейт повторов увидел семнадцать одинаковых строк — и был прав не
 * размером, а смыслом: «чем человек называет себя серверу» — вопрос
 * один, и отвечать на него в двух местах значит однажды ответить
 * по-разному.
 *
 * Цена расхождения тут не косметическая. Стоит в одном месте забыть
 * `autoComplete`, и менеджер паролей перестаёт предлагать сохранённое
 * ровно на одной из дверей — человек решает, что «вход сломался».
 *
 * ⚠️ ПОДСКАЗКА ПАРОЛЯ ЗАВИСИТ ОТ ДВЕРИ. Придумываешь пароль —
 * `new-password`, и браузер предложит сгенерировать; входишь
 * существующим — `current-password`, и он подставит сохранённый.
 * Одно значение на оба случая ломает то одно, то другое.
 */
export function Credentials({
  email,
  password,
  onEmail,
  onPassword,
  problem,
  newPassword,
}: {
  email: string;
  password: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  problem: FormProblem;
  /** Пароль заводится впервые — регистрация или вход по приглашению. */
  newPassword: boolean;
}) {
  return (
    <>
      <Field
        label="Почта"
        type="email"
        name="email"
        autoComplete="email"
        value={email}
        onChange={onEmail}
        error={problem.fields.email}
      />
      <Field
        label="Пароль"
        type="password"
        name="password"
        autoComplete={newPassword ? "new-password" : "current-password"}
        value={password}
        onChange={onPassword}
        error={problem.fields.password}
      />
    </>
  );
}
