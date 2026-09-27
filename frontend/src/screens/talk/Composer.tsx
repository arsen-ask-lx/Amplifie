import { PaperPlaneRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Message, Quote as QuoteData } from "../../data/api.js";
import { Button } from "../../shared/ui/button.js";
import { focusAfterClose, registerField } from "../../shared/ui/focusAfterClose.js";
import { Above } from "./Above.js";
import { FieldMenu } from "./FieldMenu.js";
import { type FieldApi, RichField } from "./RichField.js";

/**
 * Полоса ввода сообщения.
 *
 * `clientMsgId` рождается в момент НАЧАЛА набора и живёт, пока сообщение
 * не ушло. Поэтому повторная отправка после разрыва — то же самое
 * сообщение, а не второе такое же: сервер узнаёт его по этому ключу.
 *
 * ⚠️ САМО ПОЛЕ ТЕПЕРЬ ФОРМАТИРОВАННОЕ (Р-020, `RichField`). Здесь остался
 * только обвес: строка ответа сверху, кнопка отправки, режим правки.
 * Ни высоты, ни подгонки под текст здесь больше нет — этим занимается
 * редактор, и это половина причины, по которой он взят.
 *
 * ⚠️ ПОЛОСА ТОНКАЯ, И ЭТО ЗАМЕР, А НЕ ВКУС. У Телеграма на десктопе
 * полоса ввода около 46 пикселей высотой. Было втрое толще, и низ экрана
 * выглядел тяжелее ленты (владелец, замечание с экрана).
 *
 * ⚠️ ТА ЖЕ ПОВЕРХНОСТЬ, ЧТО И ЛЕНТА, И ОДНА ЛИНИЯ СВЕРХУ. Своя заливка
 * читалась плашкой, приклеенной снизу: у Телеграма низ экрана — то же
 * полотно, что и переписка.
 */
/**
 * Печатный знак, который сейчас никуда не попадёт: фокус не в поле ввода,
 * не в окне и не в меню. Такой знак полоса ввода забирает себе.
 */
function typedIntoNowhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length !== 1 || event.key === " ") return false;
  const active = document.activeElement;
  const typing =
    active instanceof HTMLElement &&
    (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(active.tagName));
  return !typing && document.querySelector("[role=dialog], [role=menu]") === null;
}

export function Composer({
  conversationId,
  onSend,
  replying,
  onCancelReply,
  editing,
  onCancelEdit,
  onSaveEdit,
  onEditLast,
}: {
  /** Где пишем — нужно подсказке «кого позвать» (Р-031). */
  conversationId: string | null;
  /** Этот чат в проекте — значит агента можно позвать по всему проекту. */
  onSend: (body: string, clientMsgId: string, scope?: "conversation" | "project") => void;
  replying: QuoteData | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  /** `↑` в пустом поле открывает правку последнего своего; `false` — нечего. */
  onEditLast: () => boolean;
}) {
  /**
   * Что сейчас в поле — НАШЕЙ строкой с разметкой.
   *
   * Поле само по себе держит дерево; сюда приходит уже готовая строка.
   * Через ссылку, а не состояние: её читают обработчики, а перерисовывать
   * полосу на каждую букву незачем.
   */
  const text = useRef("");
  const draftId = useRef(crypto.randomUUID());
  const field = useRef<FieldApi | null>(null);

  /** Пустое поле — чтобы гасить кнопку отправки. Это единственное, что видно. */
  const [empty, setEmpty] = useState(true);

  /**
   * Читать ли агенту весь проект (Р-032).
   *
   * ⚠️ ПО УМОЛЧАНИЮ — НЕТ, И ЭТО НЕ ОСТОРОЖНОСТЬ. Широкая область стоит
   * во столько раз дороже, сколько в проекте чатов, а нужна далеко
   * не каждому вопросу. Молчаливое «читай всё» превратило бы каждый зов
   * в самый дорогой из возможных.
   *
   * Держится до перезагрузки и сбрасывается при переходе в другой чат:
   * область — свойство вопроса, а не человека.
   */

  /**
   * Начали править — в поле встаёт текущий текст реплики.
   *
   * Зависимость по идентификатору, а не по самой реплике: объект приезжает
   * новым при каждой перерисовке ленты, и по нему поле затирало бы всё,
   * что человек успел набрать.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: правку открывает смена реплики, а не её поля
  useEffect(() => {
    if (editing) {
      field.current?.fill(editing.body);
      field.current?.focus();
    } else {
      field.current?.clear();
    }
  }, [editing?.id]);

  /**
   * Курсор в поле — сразу и ещё раз, когда меню или окно отпустят фокус.
   *
   * ⚠️ ЗАЯВКА ВМЕСТО ТРЁХ ТАЙМЕРОВ (владелец 26.09). Меню «Ответить» и окно
   * «Новый чат» закрываются дольше, чем ждали таймеры в 0, 60 и 150 мс,
   * и забирают фокус себе — «Ответить» в первый раз оставляло курсор
   * в никуда. Теперь окно само отдаёт фокус полю в миг закрытия
   * (`focusAfterClose`).
   */
  const takeFocus = () => {
    field.current?.focus();
    focusAfterClose(() => field.current?.focus());
  };

  /**
   * Открыл чат — сразу печатаешь (владелец 26.09: «нужно ткнуть в строку
   * ввода и только потом печатать — жутко неудобно»). Так в Telegram:
   * выбрал чат — курсор уже в поле.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: фокус по смене чата, а не по ссылке на поле
  useEffect(() => {
    if (conversationId) takeFocus();
  }, [conversationId]);

  // Щелчок по уже открытому чату в панели тоже возвращает курсор сюда.
  useEffect(() => registerField(() => field.current?.focus()), []);

  /**
   * Печатаешь — буквы идут в поле, куда бы ни щёлкнул до этого (как в Telegram
   * Desktop). Владелец 26.09: щелчок по закреплённому или по ленте уводил
   * фокус, и набранное уходило в никуда.
   *
   * ⚠️ ТОЛЬКО ПЕЧАТНЫЙ ЗНАК И ТОЛЬКО ВНЕ ДРУГОГО ПОЛЯ. Сочетания (Ctrl+C,
   * Shift+F10) и стрелки остаются тем, чем были. Пробел — ленте: им листают.
   * Открыто окно или меню — буквы принадлежат ему.
   *
   * Фокус меняется ДО того, как браузер вставит знак, поэтому знак ложится
   * уже в поле: ловить и повторять его руками не нужно.
   */
  useEffect(() => {
    const redirect = (event: KeyboardEvent) => {
      if (typedIntoNowhere(event)) field.current?.focus();
    };
    window.addEventListener("keydown", redirect, true);
    return () => window.removeEventListener("keydown", redirect, true);
  }, []);

  /** Взяли реплику в ответ — курсор сразу в поле. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: важен факт появления цитаты, а не её поля
  useEffect(() => {
    if (replying) takeFocus();
  }, [replying?.id]);

  /**
   * Отправить.
   *
   * Поле очищается сразу и ничего не ждёт: реплика встаёт в ленту
   * с часиками, а её судьба помечается на ней же.
   */
  function submit(): void {
    /**
     * ⚠️ СПРАШИВАЕМ РЕДАКТОР, А НЕ КОПИЮ (Д-21). Копия ниже обновляется
     * слушателем редактора, а тот зовётся следующим тактом. Кто вставил
     * текст и мгновенно нажал ввод — отправлял пустоту и оставался
     * с заполненным полем. Копия осталась только у выключенной кнопки:
     * ей нужно значение на каждое нажатие, и опоздание на такт там не видно.
     *
     * Запасной путь на случай, если поле ещё не назвалось (первый кадр):
     * тогда единственное, что у нас есть, — копия.
     */
    const body = (field.current?.read() ?? text.current).trim();
    if (!body) return;

    if (editing) {
      void onSaveEdit(body);
      return;
    }

    const key = draftId.current;
    draftId.current = crypto.randomUUID();
    text.current = "";
    setEmpty(true);
    field.current?.clear();
    field.current?.focus();
    /**
     * ⚠️ ОБЛАСТЬ ВСЕГДА «ЭТОТ ЧАТ» — ПЕРЕКЛЮЧАТЕЛЬ УБРАН 10.09 по слову
     * владельца («эту фигню тоже убрать, чё она тут вообще делает»).
     * Он висел кружком «по проекту» рядом с отправкой и просил решения
     * там, где человек занят другим — набором сообщения.
     *
     * ⚠️ САМА СПОСОБНОСТЬ ЖИВА: сервер по-прежнему умеет читать весь
     * проект (Р-032), и дверь принимает `scope`. Не хватает ей только
     * места в интерфейсе — и это записано долгом, а не забыто.
     */
    onSend(body, key, "conversation");
  }

  return (
    <form
      className="border-t border-line bg-bg px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;

        /**
         * ⚠️ ОТМЕНА БРАУЗЕРНОГО ДЕЙСТВИЯ ЗДЕСЬ ГЛАВНЕЕ САМОЙ ОТМЕНЫ ОТВЕТА.
         *
         * Escape в редактируемой области Chrome уводит фокус на страницу.
         * Снаружи это не видно ничем: поле выглядит прежним, а буквы,
         * которые человек печатает дальше, не появляются нигде. Поймано
         * живым обходом — в ленте оказалась реплика, где хвост фразы встал
         * ПЕРЕД началом.
         *
         * Раньше эта строка стояла ПОСЛЕ проверки «есть ли что отменять»,
         * то есть срабатывала только при ответе и правке. В остальное
         * время — а это почти всё время — Escape убивал поле.
         *
         * Пока открыта подсказка упоминаний, клавишу забирает она и сюда
         * ничего не доходит: список закрывается, фокус цел.
         */
        event.preventDefault();

        // Escape снимает и ответ, и правку — то же, что крестик в строке выше.
        if (editing) onCancelEdit();
        else if (replying) onCancelReply();
      }}
    >
      <Above
        replying={replying}
        editing={editing}
        onCancel={editing ? onCancelEdit : onCancelReply}
      />

      <div className="flex items-end gap-2">
        <FieldMenu field={field}>
          <RichField
            conversationId={conversationId}
            placeholder={editing ? "Изменить сообщение" : "Написать в канал"}
            onChange={(markup) => {
              text.current = markup;
              const nowEmpty = markup.trim().length === 0;
              setEmpty((was) => (was === nowEmpty ? was : nowEmpty));
            }}
            onSend={submit}
            onEditLast={editing ? undefined : onEditLast}
            onReady={(api) => {
              field.current = api;
            }}
          />
        </FieldMenu>

        <Button
          type="submit"
          size="icon-sm"
          disabled={empty}
          aria-label={editing ? "Сохранить" : "Отправить"}
          title={editing ? "Сохранить (Enter)" : "Отправить (Enter)"}
          className="rounded-pill"
        >
          <PaperPlaneRight />
        </Button>
      </div>
    </form>
  );
}
