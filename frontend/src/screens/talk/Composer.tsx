import { PaperPlaneRight } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Message, Quote as Цитата } from "../../data/api.js";
import { Button } from "../../shared/ui/button.js";
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
export function Composer({
  conversationId,
  onSend,
  replying,
  onCancelReply,
  editing,
  onCancelEdit,
  onSaveEdit,
}: {
  /** Где пишем — нужно подсказке «кого позвать» (Р-031). */
  conversationId: string | null;
  /** Этот чат в проекте — значит агента можно позвать по всему проекту. */
  onSend: (body: string, clientMsgId: string, scope?: "conversation" | "project") => Promise<void>;
  replying: Цитата | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
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
   * Взяли реплику в ответ — курсор сразу в поле.
   *
   * ⚠️ НЕ СРАЗУ, А ТРЕМЯ ПОПЫТКАМИ. Меню по правой кнопке доигрывает
   * закрытие ПОСЛЕ обработчика пункта и уводит фокус — не одним действием,
   * а цепочкой отложенных. Замер показывал `BODY` даже через 400 мс.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: важен факт появления цитаты, а не её поля
  useEffect(() => {
    if (!replying) return;
    const timers = [0, 60, 150].map((delay) => setTimeout(() => field.current?.focus(), delay));
    return () => timers.forEach(clearTimeout);
  }, [replying?.id]);

  /**
   * Отправить.
   *
   * Поле очищается сразу и ничего не ждёт: реплика встаёт в ленту
   * с часиками, а её судьба помечается на ней же.
   */
  function submit(): void {
    const body = text.current.trim();
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
    void onSend(body, key, "conversation");
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
