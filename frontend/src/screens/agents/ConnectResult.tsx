import { Check, Copy } from "@phosphor-icons/react";
import { Button } from "../../shared/ui/button.js";
import { Input } from "../../shared/ui/input.js";
import { QUIET_FIELD } from "../../shared/ui/quiet-field.js";

/**
 * Что показывает окно подключения моста: строку запуска и итог проверки.
 *
 * ⚠️ СВОЙ ФАЙЛ ПО ВОПРОСУ, А НЕ ПО РАЗМЕРУ. `ModelScreen` отвечает на «что
 * происходит с мостом» — выдать код, проверить, открыть окно; здесь — «как
 * выглядит результат». Вместе они перевалили предел размера, когда
 * результат переехал в окно поверх страницы (task-062).
 */

/**
 * Строка запуска: показывается один раз, копируется одной кнопкой.
 *
 * ⚠️ ГАЛОЧКА В КОНЦЕ ПОЛЯ, А НЕ НАДПИСЬ НА КНОПКЕ. «Скопировать» →
 * «Скопировано» меняет ширину кнопки, и соседние прыгают следом. Знак
 * стоит там же, где лежит скопированное, — и ничего не двигает.
 * О самом копировании уже сказала плашка; надпись повторяла её третий раз.
 */
export function Command({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <Input
        className={`${QUIET_FIELD} pr-11 text-aside`}
        readOnly
        value={command}
        onFocus={(event) => event.target.select()}
        aria-label="Строка запуска моста"
      />
      {/* ⚠️ ЗНАЧОК В САМОМ ПОЛЕ, А НЕ КНОПКА В РЯДУ ДЕЙСТВИЙ. Копирование
          относится к этой строке, а не к окну: рядом с ней ему и место —
          так же, как в Телеграме. Заодно ряд внизу остаётся коротким,
          и в нём видно то, что действительно меняет состояние. */}
      <Button
        className="-translate-y-1/2 absolute top-1/2 right-1"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Скопировано" : "Копировать строку запуска"}
        onClick={onCopy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** Что вышло из проверки: ответ модели либо причина отказа. */
export function Outcome({
  answer,
  failure,
}: {
  answer: { text: string; ms: number } | null;
  failure: string | null;
}) {
  return (
    <>
      {answer ? (
        <blockquote className="mt-3 rounded border-l-2 border-accent bg-panel px-3 py-2">
          <p className="text-body leading-relaxed text-ink">{answer.text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-aside text-muted">
            <span>ответ настоящей модели за {(answer.ms / 1000).toFixed(1)} с</span>
          </p>
        </blockquote>
      ) : null}
      {failure ? <p className="mt-3 text-aside text-danger">{failure}</p> : null}
    </>
  );
}
