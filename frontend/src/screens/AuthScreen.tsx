import { useEffect, useState } from "react";
import { api, type Me } from "../data/api.js";
import { describeFailure, type FormProblem } from "../shared/authMessages.js";
import { Field } from "../shared/Field.js";
import { Button } from "../shared/ui/button.js";
import { EntryFrame } from "./entry/EntryFrame.js";
import { МОСТ } from "./entry/pictures.js";

/**
 * Какую дверь показать. `null` — ещё не спросили сервер (task-023).
 *
 * ⚠️ ЖДЁМ ОТВЕТА, А НЕ УГАДЫВАЕМ. Показать «Вход» и через мгновение
 * заменить его на «Создать пространство» — это мигание ровно в тот
 * момент, когда человек видит продукт впервые в жизни. Ответ приходит
 * со своего же сервера и занимает миллисекунды.
 */
type Mode = "login" | "register" | null;

const EMPTY: FormProblem = { fields: {}, common: null };

interface Draft {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
}

const BLANK: Draft = { email: "", password: "", displayName: "", workspaceName: "" };

/**
 * Спросить сервер, какая здесь дверь.
 *
 * Отдельным крючком: у экрана и без того четыре состояния, и линтер
 * сложности был прав — «какая дверь» и «что с формой» разные вопросы.
 */
function useDoor(): { mode: Mode; mayCreate: boolean; setMode: (mode: Mode) => void } {
  const [mode, setMode] = useState<Mode>(null);
  const [mayCreate, setMayCreate] = useState(false);

  useEffect(() => {
    api.entry().then(
      ({ registrationOpen }) => {
        setMayCreate(registrationOpen);
        // Компании ещё нет — значит и войти некому: показываем установку.
        setMode(registrationOpen ? "register" : "login");
      },
      () => {
        // Сервер не ответил. Вход — единственная дверь, которая может
        // сработать: заведение компании на занятой установке всё равно
        // кончится отказом. Гадать тут не о чем.
        setMode("login");
      },
    );
  }, []);

  return { mode, mayCreate, setMode };
}

/**
 * Заголовок двери и общая беда над формой.
 *
 * Вынесено не ради красоты: у экрана набралась сложность 12 при потолке
 * 10, и линтер был прав — «какая дверь», «какие поля» и «что пошло
 * не так» читались одним куском.
 */
function Head({ isRegister, trouble }: { isRegister: boolean; trouble: string | null }) {
  return (
    <>
      <h1 className="mb-1 text-brand leading-tight text-ink">
        {isRegister ? "Создать пространство" : "С возвращением"}
      </h1>
      <p className="mt-2 mb-6 text-body leading-relaxed text-muted">
        {isRegister
          ? "Рабочее место, где агенты слышат разговор"
          : "Разговор, из которого выходят задачи"}
      </p>

      {trouble ? (
        <div className="mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
          {trouble}
        </div>
      ) : null}
    </>
  );
}

/** Поля, которые есть только у установки: кто вы и как назвать компанию. */
function Extra({
  draft,
  problem,
  set,
}: {
  draft: Draft;
  problem: FormProblem;
  set: (key: keyof Draft) => (value: string) => void;
}) {
  return (
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
  );
}

export function AuthScreen({
  onEntered,
  onInstalled,
}: {
  /** Человек вошёл в существующую компанию. */
  onEntered: (me: Me) => void;
  /**
   * Компанию только что завели — дальше мастер первого запуска.
   *
   * ⚠️ ОТДЕЛЬНЫЙ ОБРАБОТЧИК, А НЕ ПРИЗНАК У ПЕРВОГО. Было
   * `onEntered(me, installed)`, и по месту вызова не читалось, что
   * значит `true`. Два имени называют два события своими словами —
   * снаружи их и обрабатывают по-разному.
   */
  onInstalled: (me: Me) => void;
}) {
  const { mode, mayCreate, setMode } = useDoor();
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
      if (isRegister) onInstalled(await api.register(draft));
      else onEntered(await api.login(draft));
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

  // Пока не знаем, какая дверь, — рама и знак уже на месте, а формы нет.
  if (mode === null) return <EntryFrame picture={МОСТ}>{null}</EntryFrame>;

  return (
    <EntryFrame picture={МОСТ}>
      <form onSubmit={submit} noValidate>
        <Head isRegister={isRegister} trouble={problem.common} />

        <Field
          label="Почта"
          type="email"
          name="email"
          autoComplete="email"
          value={draft.email}
          onChange={set("email")}
          error={problem.fields.email}
        />
        <Field
          label="Пароль"
          type="password"
          name="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={draft.password}
          onChange={set("password")}
          error={problem.fields.password}
        />

        {isRegister ? <Extra draft={draft} problem={problem} set={set} /> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Минуту…" : isRegister ? "Создать" : "Войти"}
        </Button>

        {/* Вторая дверь тише первой и по середине: главное действие здесь
          одно — войти. «Создать пространство» — это УСТАНОВКА продукта,
          и делают её один раз в жизни сервера (Р-024).

          ⚠️ НА ЗАНЯТОЙ УСТАНОВКЕ ЭТОЙ ДВЕРИ НЕТ ВОВСЕ. Раньше она
          показывалась всегда и уверенно вела в отказ 403: сервер знал
          ответ, а сказать его было некому. Теперь знает и экран. */}
        {mayCreate ? (
          <div className="mt-2 text-center">
            {/* ⚠️ `type="button"` ОБЯЗАТЕЛЕН, И БЕЗ НЕГО ЭТО НЕ ССЫЛКА,
              А ВТОРАЯ КНОПКА ОТПРАВКИ. Внутри формы браузер считает кнопку
              без типа отправляющей: нажатие переключало дверь И отправляло
              пустую форму разом. Человек видел ошибки полей там, где ничего
              не отправлял. Пряталось за английским текстом проверялки —
              нашлось живым прогоном. */}
            <Button
              variant="link"
              size="sm"
              className="text-aside font-normal text-muted"
              onClick={switchMode}
            >
              {isRegister ? "У меня уже есть вход" : "Создать новое пространство"}
            </Button>
          </div>
        ) : null}
      </form>
    </EntryFrame>
  );
}
