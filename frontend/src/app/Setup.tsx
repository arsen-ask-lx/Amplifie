import { useCallback, useState } from "react";
import { api, type Bridge } from "../data/api.js";
import { KeyPanel } from "../screens/agents/KeyPanel.js";
import { ModelScreen } from "../screens/agents/ModelScreen.js";
import { EntryFrame } from "../screens/entry/EntryFrame.js";
import { Button } from "../shared/ui/button.js";
import { usePolling } from "../shared/usePolling.js";
import { InviteDialog } from "./InviteDialog.js";

/**
 * Мастер первого запуска (task-023).
 *
 * ⚠️ ЭТО ПРОДОЛЖЕНИЕ ДВЕРИ, А НЕ НОВЫЙ ЭКРАН. Та же рама, тот же
 * монохром, та же картинка справа: человек только что завёл компанию,
 * и перенос его в другое место читался бы как «что-то пошло не так».
 *
 * ⚠️ НИ ОДНОГО СВОЕГО ЭКРАНА ВНУТРИ. Подключение подписки, ключ и
 * приглашение уже написаны и живут в продукте; мастер их рассаживает.
 * Вторая копия подключения моста разошлась бы с первой при первой же
 * правке Р-012 — и разошлась бы молча.
 *
 * ⚠️ ШАГОВ ДВА, А НЕ ТРИ, И ЭТО ОТКРЫЛОСЬ ПРИ РАБОТЕ. В плане «подключить»
 * и «проверить» стояли врозь, но `ModelScreen` уже кончается живой
 * проверкой — настоящим вопросом настоящей модели. Отдельный шаг был бы
 * второй кнопкой к тому же запросу.
 *
 * ⚠️ ЖИВЁТ В `app/`, А НЕ В `screens/`, И ЭТО СКАЗАЛ ГЕЙТ ГРАНИЦ.
 * Сперва мастер лежал экраном — и сразу нарушил три правила: экран
 * не смеет знать оболочку и не смеет лезть во внутренности чужого
 * раздела. Гейт был прав по существу: мастер ничего не рисует сам,
 * он СШИВАЕТ куски из разных разделов, а это работа слоя сборки.
 *
 * ⚠️ СОСТОЯНИЕ ЖИВЁТ В ПАМЯТИ ВКЛАДКИ (владелец выбрал вариант А).
 * Перезагрузил на середине — попал в продукт, а всё то же лежит
 * в «Агентах» и «Пригласить». Цена названа в плане: мастер одноразовый.
 */

/** Пока мастер открыт, мост может подключиться в соседнем окне. */
const REFRESH_MS = 3000;

type Step = "модель" | "команда";

/** Чем человек решил думать. Ключ и подписка живут в разных местах. */
type Choice = "подписка" | "ключ" | null;

function Steps({ step }: { step: Step }) {
  return (
    <p className="mb-6 text-aside text-muted">
      {step === "модель" ? "Шаг 1 из 2" : "Шаг 2 из 2"} · установка
    </p>
  );
}

/** Выбор способа. Две карточки, и обе объясняют цену словами. */
function Choose({ onPick }: { onPick: (choice: Choice) => void }) {
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => onPick("подписка")}
        className="rounded-xl border border-line bg-card p-4 text-left hover:border-edge"
      >
        <span className="block text-body font-medium text-ink">Своя подписка</span>
        <span className="mt-1 block text-aside text-muted">
          У вас уже есть Claude или Codex — агент будет спрашивать их на вашей машине. Сверху
          платить не придётся, но компьютер должен быть включён.
        </span>
      </button>

      <button
        type="button"
        onClick={() => onPick("ключ")}
        className="rounded-xl border border-line bg-card p-4 text-left hover:border-edge"
      >
        <span className="block text-body font-medium text-ink">Ключ</span>
        <span className="mt-1 block text-aside text-muted">
          Работает откуда угодно и без включённого компьютера. Платите по расходу.
        </span>
      </button>
    </div>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("модель");
  const [choice, setChoice] = useState<Choice>(null);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [inviting, setInviting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBridges((await api.bridges()).items);
    } catch {
      // Список мостов — не то, ради чего стоит ронять установку.
      // Человек увидит это по тому, что состояние не меняется.
    }
  }, []);
  usePolling(refresh, REFRESH_MS);

  // Шаг сменился — читать начинают сверху. Без этого второй шаг открывался
  // прокрученным на высоту первого: знак уезжал за край, и экран выглядел
  // обрезанным. Видно только живым прогоном — высота шагов разная.
  /**
   * Перейти на шаг и начать его сверху.
   *
   * Прокрутка здесь, а не в следствии: шаг меняет нажатие, и листать надо
   * ровно на нажатие. Без этого второй шаг открывался прокрученным
   * на высоту первого — знак уезжал за край, и экран выглядел обрезанным.
   * Видно только живым прогоном: высота шагов разная.
   */
  const go = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  if (step === "команда") {
    return (
      <EntryFrame>
        <Steps step={step} />
        <h1 className="mb-1 text-brand leading-tight text-ink">Позовите команду</h1>
        <p className="mt-2 mb-6 text-body leading-relaxed text-muted">
          По ссылке коллеги заведут себе вход и окажутся в этой же компании. Других дверей внутрь
          нет — регистрация закрыта с первого человека.
        </p>

        <Button className="w-full" onClick={() => setInviting(true)}>
          Сделать ссылку
        </Button>
        <div className="mt-2 text-center">
          <Button
            variant="link"
            size="sm"
            className="text-aside font-normal text-muted"
            onClick={onDone}
          >
            Позже — открыть чат
          </Button>
        </div>

        {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
      </EntryFrame>
    );
  }

  return (
    <EntryFrame>
      <Steps step={step} />
      <h1 className="mb-1 text-brand leading-tight text-ink">Чем будет думать агент</h1>
      <p className="mt-2 mb-6 text-body leading-relaxed text-muted">
        Без этого агент промолчит: разговор будет, а сводок и задач из него — нет.
      </p>

      {choice === null ? <Choose onPick={setChoice} /> : null}
      {choice === "подписка" ? <ModelScreen bridges={bridges} onChanged={refresh} /> : null}
      {choice === "ключ" ? <KeyPanel onChange={refresh} /> : null}

      <div className="mt-4 grid gap-2">
        {choice === null ? null : (
          <Button className="w-full" onClick={() => go("команда")}>
            Дальше
          </Button>
        )}
        <div className="text-center">
          <Button
            variant="link"
            size="sm"
            className="text-aside font-normal text-muted"
            onClick={() => (choice === null ? go("команда") : setChoice(null))}
          >
            {choice === null ? "Пропустить — подключу позже" : "Выбрать по-другому"}
          </Button>
        </div>
      </div>
    </EntryFrame>
  );
}
