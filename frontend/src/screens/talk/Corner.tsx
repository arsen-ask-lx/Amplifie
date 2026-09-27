import { Check, Clock, WarningCircle } from "@phosphor-icons/react";
import { dayFormat, timeFormat } from "../../shared/when.js";
import type { Row } from "./rows.js";

/** Отправить «не ушедшие» ещё раз. Нет — «!» остаётся просто значком. */
type Retry = (() => void) | undefined;

/**
 * Подпись в углу реплики: изменено, время, состояние доставки.
 *
 * ⚠️ ЖИВЁТ ОТДЕЛЬНО, ПОТОМУ ЧТО РИСУЕТСЯ ДВАЖДЫ. Видимая подпись вынута
 * из потока, поэтому текст о ней не знает; место под неё отводит
 * невидимая копия внутри текста. Копия и оригинал обязаны совпадать
 * знак в знак, а разъезжаются такие пары ровно тогда, когда лежат
 * в разных файлах.
 */

/**
 * Что стало с моей репликой — значком рядом со временем.
 *
 * ⚠️ ОДНА ГАЛОЧКА, А НЕ ДВЕ. В Телеграме вторая означает «прочитано»,
 * а мы про прочтение не знаем ничего: отметок чтения у нас нет. Две
 * галочки были бы не украшением, а утверждением, которого мы не можем
 * проверить. Одна честно значит «дошло до сервера».
 *
 * У чужих реплик значка нет вовсе: их доставка — не наше дело.
 */
function State({ row, shadow = false, onRetry }: { row: Row; shadow?: boolean; onRetry?: Retry }) {
  if (!row.mine) return null;
  /**
   * ⚠️ У НЕВИДИМОЙ КОПИИ ПОДПИСИ БЫТЬ НЕ ДОЛЖНО. `aria-hidden` на обёртке
   * прячет копию от чтения вслух, но `aria-label` остаётся в странице —
   * и «доставлено» находится дважды. На этом сразу лёг общий шаг
   * подготовки всех проверок чата.
   */
  const ariaLabel = (label: string) => (shadow ? { "aria-hidden": true } : { "aria-label": label });
  if (row.message.state === "идёт") {
    return <Clock {...ariaLabel("отправляется")} className="size-3 opacity-70" />;
  }
  if (row.message.state === "не ушло") {
    if (shadow || !onRetry) {
      return <WarningCircle {...ariaLabel("не ушло")} className="size-3 text-danger" />;
    }
    return <RetryButton onRetry={onRetry} />;
  }
  return <Check {...ariaLabel("доставлено")} className="size-3 opacity-70" />;
}

/**
 * «!» — кнопка, а не приговор (task-111). Уходят заново все «не ушедшие»
 * вкладки, в порядке набора и тем же ключом: сервер их не задвоит.
 *
 * ⚠️ БЕЗ ПОЛЕЙ И РАМКИ, И ЭТО НЕ НЕБРЕЖНОСТЬ. Невидимая копия подписи
 * держит место одним значком; кнопка шире значка сдвинула бы время
 * и наехала на текст.
 */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      aria-label="Не ушло — повторить отправку"
      title="Не ушло. Нажмите, чтобы отправить ещё раз"
      className="inline-flex cursor-pointer text-danger"
      onClick={(event) => {
        // Строка в режиме выделения слушает тот же щелчок.
        event.stopPropagation();
        onRetry();
      }}
    >
      <WarningCircle aria-hidden="true" className="size-3" />
    </button>
  );
}

/**
 * Поля пузыря и свес подписи за них.
 *
 * ⚠️ ВРЕМЯ НЕ ВЫРОВНЕНО ПО ТЕКСТУ, И ЭТО НЕ НЕБРЕЖНОСТЬ, А ТЕЛЕГРАМ.
 * У них (`ui/chat/chat.style`) поля текста в пузыре — 11 точек по бокам
 * и 8 сверху и снизу, а подпись рисуется по правилу
 * `правый край − (поле − msgDateDelta)`, где `msgDateDelta` = 2 вправо
 * и 5 вниз. То есть время СВИСАЕТ за поле текста: ближе к углу, чем
 * сам текст. Выровняй его по тексту — и оно сядет на последнюю строку,
 * ровно на что владелец и пожаловался.
 *
 * Наши поля — 12 и 8 (`px-3 py-2`), свес тот же.
 */
const OVERHANG_RIGHT = "right-2.5"; /* 12 − 2 */
const OVERHANG_BOTTOM = "bottom-[3px]"; /* 8 − 5 */

/**
 * Воздух между последним словом и временем.
 *
 * У Телеграма это `msgDateSpace` = 12 точек
 * (`skipBlockWidth = msgDateSpace + ширина времени − msgDateDelta.x`,
 * `history_view_element.cpp`), и свес отдаёт 2 из них сам — значит
 * отступу остаётся 10.
 *
 * ⚠️ У НАС 8, А НЕ 10, И ЭТО НЕ ОКРУГЛЕНИЕ ВНИЗ. Десять не стоит на нашей
 * сетке в 4 точки, и гейт ритма прав, что не пускает: одно значение мимо
 * сетки читается как небрежность (Р-014). Восемь плюс свес дают те же
 * десять просвета — и это соразмерно нашему шрифту: у нас речь 14 и время
 * 11 против их 15 и 13, то есть всё мельче примерно на восьмую часть.
 */
const GAP = "pl-2";

/**
 * Что стоит в углу: изменено, время, состояние доставки.
 *
 * ⚠️ РИСУЕТСЯ ДВАЖДЫ, И ВТОРОЙ РАЗ — НЕВИДИМО. Подпись вынута из потока,
 * поэтому текст о ней не знает и заезжает под неё. Место под неё
 * отводится невидимой копией внутри текста — так же, как это делает
 * Телеграм своим skip block. Копия обязана быть ИМЕННО КОПИЕЙ: считать
 * ширину числом (у нас стояло 48 точек) значит промахнуться, как только
 * появится «изм.» или сменится значок доставки.
 *
 * `тень` меняет только тег времени: двух `<time>` на одну реплику
 * в странице быть не должно.
 */
/** «изменено 14:32» — а если не сегодня, то и день: «изменено 9 сентября, 14:32». */
function editedTitle(editedAt: string): string {
  const at = new Date(editedAt);
  const today = new Date().toDateString() === at.toDateString();
  const time = timeFormat.format(at);
  return today ? `изменено ${time}` : `изменено ${dayFormat.format(at)}, ${time}`;
}

function Marks({ row, shadow = false, onRetry }: { row: Row; shadow?: boolean; onRetry?: Retry }) {
  const text = timeFormat.format(new Date(row.message.createdAt));
  return (
    <>
      {row.message.editedAt ? (
        <span title={shadow ? undefined : editedTitle(row.message.editedAt)}>изм.</span>
      ) : null}
      {shadow ? <span>{text}</span> : <time dateTime={row.message.createdAt}>{text}</time>}
      <State row={row} shadow={shadow} onRetry={onRetry} />
    </>
  );
}

/** Подпись в углу: изменено, время, состояние доставки. */
export function Corner({ row, onRetry }: { row: Row; onRetry?: Retry }) {
  return (
    <span
      className={[
        "absolute flex items-center gap-1 text-mark",
        OVERHANG_RIGHT,
        OVERHANG_BOTTOM,
        row.mine ? "text-muted-on-soft" : "text-muted",
      ].join(" ")}
    >
      <Marks row={row} onRetry={onRetry} />
    </span>
  );
}

/**
 * Распорка под подпись: невидимая копия плюс воздух.
 *
 * ⚠️ КОПИЯ, А НЕ ЧИСЛО. Раньше здесь стояла ширина в 48 точек — и она
 * промахивалась, как только появлялось «изм.» или менялся значок
 * доставки. Телеграм отводит место тем же способом (skip block),
 * и по той же причине.
 */
export function Spacer({ row }: { row: Row }) {
  return (
    <span
      aria-hidden="true"
      className={["invisible inline-flex select-none items-center gap-1 text-mark", GAP].join(" ")}
    >
      <Marks row={row} shadow />
    </span>
  );
}
