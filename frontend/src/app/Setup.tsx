import { useCallback, useState } from "react";
import { api, type Bridge } from "../data/api.js";
import { KeyPanel } from "../screens/agents/KeyPanel.js";
import { ModelScreen } from "../screens/agents/ModelScreen.js";
import { EntryFrame } from "../screens/entry/EntryFrame.js";
import { ECLIPSE_PICTURE } from "../screens/entry/pictures.js";
import { Button } from "../shared/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog.js";
import { usePolling } from "../shared/usePolling.js";

/**
 * Мастер первого запуска (task-023).
 *
 * ⚠️ ЭТО ПРОДОЛЖЕНИЕ ДВЕРИ, А НЕ НОВЫЙ ЭКРАН. Та же рама, тот же
 * монохром, та же картинка справа: человек только что завёл компанию,
 * и перенос его в другое место читался бы как «что-то пошло не так».
 *
 * ⚠️ НИ ОДНОГО СВОЕГО ЭКРАНА ВНУТРИ. Подключение подписки и ключ уже
 * написаны и живут в продукте; мастер их рассаживает. Вторая копия
 * подключения моста разошлась бы с первой при первой же правке Р-012 —
 * и разошлась бы молча.
 *
 * ⚠️ ШАГ ОДИН, ХОТЯ В ПЛАНЕ ИХ БЫЛО ТРИ. «Подключить» и «проверить»
 * слились: `ModelScreen` уже кончается живой проверкой — настоящим
 * вопросом настоящей модели, и отдельный шаг был бы второй кнопкой
 * к тому же запросу.
 *
 * «Позовите команду» убран по слову владельца: рядом с приглашением
 * стояло «другого способа попасть внутрь нет», и шаг читался как
 * «не сделаешь сейчас — не пригласишь никогда». На деле ссылка живёт
 * в меню профиля и доступна каждый день. Установка не место для того,
 * что делают постоянно.
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

/** Чем человек решил думать. Ключ и подписка живут в разных местах. */
type Choice = "subscription" | "key" | null;

/** Что написано в окне у каждого способа. */
const DIALOG_TEXT = {
  subscription: { title: "Своя подписка", about: null },
  key: { title: "Ключ API", about: null },
} as const;

/** Выбор способа. Две карточки, и обе объясняют условие словами. */
function Choose({ onPick }: { onPick: (choice: Choice) => void }) {
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => onPick("subscription")}
        className="rounded-xl border border-line bg-card p-4 text-left hover:border-edge"
      >
        <span className="block text-body font-medium text-ink">Своя подписка</span>
        <span className="mt-1 block text-aside text-muted">
          Агент спрашивает нейросеть на вашем компьютере, вашим же клиентом. Отвечает, пока
          компьютер включён.
        </span>
      </button>

      <button
        type="button"
        onClick={() => onPick("key")}
        className="rounded-xl border border-line bg-card p-4 text-left hover:border-edge"
      >
        <span className="block text-body font-medium text-ink">Ключ API</span>
        <span className="mt-1 block text-aside text-muted">
          Ключ поставщика хранится у нас в зашифрованном виде. Работает всегда, компьютер не нужен.
        </span>
      </button>
    </div>
  );
}

/**
 * Выход со экрана: тихая ссылка, пока ничего не подключено, и сплошная
 * кнопка, когда подключено. Вынесено из экрана — тот набрал сложность 12
 * при потолке 10, и линтер был прав: «чем платим» и «куда идём» разное.
 */
function Exit({ connected, onDone }: { connected: boolean; onDone: () => void }) {
  return (
    <div className="mt-4 text-center">
      <Button
        variant={connected ? "default" : "link"}
        size={connected ? "default" : "sm"}
        className={connected ? "w-full" : "text-aside font-normal text-muted"}
        onClick={onDone}
      >
        {connected ? "Готово — открыть чат" : "Подключить позже"}
      </Button>
    </div>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [choice, setChoice] = useState<Choice>(null);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  /** Ключ сохранён в этом окне. Мост виден опросом, ключ — только так. */
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBridges((await api.bridges()).items);
    } catch {
      // Список мостов — не то, ради чего стоит ронять установку.
      // Человек увидит это по тому, что состояние не меняется.
    }
  }, []);
  usePolling(refresh, REFRESH_MS);

  const connected = bridges.some((one) => one.online) || saved;
  const dialogText = choice ? DIALOG_TEXT[choice] : null;

  return (
    <EntryFrame picture={ECLIPSE_PICTURE}>
      <h1 className="mb-6 text-brand leading-tight text-ink">Подключение модели</h1>

      <Choose onPick={setChoice} />

      <Exit connected={connected} onDone={onDone} />

      {/* ⚠️ ПАНЕЛЬ ЖИВЁТ В ОКНЕ, А НЕ РАЗВОРАЧИВАЕТСЯ НА МЕСТЕ. Внутри
        колонки шириной в двадцать шесть знаков ей тесно: кнопки уезжают
        в три строки, а появление кода подключения дёргает всю страницу.
        Окно шире и не двигает то, что под ним. */}
      <Dialog open={choice !== null} onOpenChange={(open) => !open && setChoice(null)}>
        <DialogContent
          className={`max-h-[80dvh] overflow-y-auto ${choice === "subscription" ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
        >
          {dialogText ? (
            <DialogHeader>
              <DialogTitle>{dialogText.title}</DialogTitle>
              {dialogText.about ? <DialogDescription>{dialogText.about}</DialogDescription> : null}
            </DialogHeader>
          ) : null}

          {choice === "subscription" ? (
            <ModelScreen bridges={bridges} onChanged={refresh} issueAtOnce />
          ) : null}
          {choice === "key" ? (
            <KeyPanel
              onChange={() => {
                setSaved(true);
                void refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </EntryFrame>
  );
}
