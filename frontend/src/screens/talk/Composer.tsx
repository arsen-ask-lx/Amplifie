import { Pencil, SendHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message, Quote as Цитата } from "../../data/api.js";
import { Button } from "../../shared/ui/button.js";
import { Quote } from "./Quote.js";

/**
 * Поле ввода сообщения.
 *
 * `clientMsgId` рождается в момент НАЧАЛА набора и живёт, пока сообщение
 * не ушло. Поэтому повторная отправка после разрыва — то же самое
 * сообщение, а не второе такое же: сервер узнаёт его по этому ключу.
 *
 * Поле многострочное и растёт под текст. Однострочное поле в переписке —
 * не мелочь: человек не может ни перечитать длинное, ни разбить на абзацы,
 * и начинает слать обрывками. Enter отправляет, Shift+Enter переносит.
 *
 * ⚠️ ПОЛОСА ТОНКАЯ, И ЭТО ЗАМЕР, А НЕ ВКУС. У Телеграма на десктопе
 * полоса ввода около 46 пикселей высотой: поле в одну строку плюс
 * по шесть сверху и снизу. Было втрое толще — поле в 36 пикселей
 * с полями по двенадцать, — и низ экрана выглядел тяжелее ленты
 * (владелец, замечание с экрана).
 *
 * ⚠️ ВО ВСЮ ШИРИНУ, БЕЗ СТОЛБЦА ПО ЦЕНТРУ. Столбец здесь уже был дважды
 * и дважды убирался: по бокам оставались пустые поля, а до боковой панели
 * — заметный провал. Ширину строки ограничивает САМ ПУЗЫРЬ, и этого
 * достаточно; полосе ввода ограничивать нечего.
 *
 * ⚠️ КНОПКА — КРУГЛАЯ СО СТРЕЛКОЙ, А НЕ СЛОВО «ОТПРАВИТЬ». Так в Телеграме,
 * и дело не во вкусе: слово занимает место, которое в переписке принадлежит
 * тексту, и повторяет то, что уже сказал Enter. Подпись никуда не делась —
 * она в `aria-label` и во всплывающей подсказке, вместе с горячей клавишей.
 */

/** Дальше поле не растёт, а прокручивается: иначе оно съест ленту. */
const MAX_ROWS = 10;

/**
 * Сочетания клавиш для разметки — те же, что у Телеграма на десктопе.
 *
 * ⚠️ СВОИХ НЕ ПРИДУМЫВАЕМ. Горячая клавиша полезна ровно тем, что её уже
 * знают: Ctrl+B, Ctrl+I, Ctrl+U — общие для всех редакторов, а
 * Ctrl+Shift+X, Ctrl+Shift+M и Ctrl+Shift+P взяты у них один в один.
 *
 * Ключ — «нужен ли Shift» плюс буква. Буква латинская: при русской
 * раскладке браузер всё равно сообщает `code`, а не `key`, и проверять
 * по `key` значило бы сломать сочетания у всех, кто пишет по-русски.
 */
const WRAPS: Record<string, { shift: boolean; with: string }> = {
  KeyB: { shift: false, with: "**" },
  KeyI: { shift: false, with: "*" },
  KeyU: { shift: false, with: "__" },
  KeyX: { shift: true, with: "~~" },
  KeyM: { shift: true, with: "`" },
  KeyP: { shift: true, with: "||" },
};

/**
 * Обернуть выделенное. Ничего не выделено — ставим пару и курсор внутрь:
 * так делают все редакторы, и это избавляет от «набрал, потом выделил».
 */
function wrap(node: HTMLTextAreaElement, mark: string): { text: string; at: number } {
  const { value, selectionStart: from, selectionEnd: to } = node;
  const inside = value.slice(from, to);
  return {
    text: value.slice(0, from) + mark + inside + mark + value.slice(to),
    at: from + mark.length + inside.length,
  };
}

/**
 * Подогнать высоту поля под текст.
 *
 * Сброс в auto обязателен: без него поле умеет только расти и никогда
 * не сжимается обратно. Рамки прибавляются отдельно — `scrollHeight`
 * их не считает, и высота выходила на два пикселя короче нужной,
 * отчего на ОДНОЙ строке появлялась полоса прокрутки.
 */
function fit(node: HTMLTextAreaElement, expected: string): void {
  // Меряем, только когда в поле УЖЕ нужное значение. Без этой проверки
  // можно посчитать высоту по старому тексту — ровно та ошибка, из-за
  // которой поле не сжималось после отправки многострочного сообщения.
  if (node.value !== expected) return;

  // Пустое поле не меряем вовсе: снимаем высоту и отдаём её обратно
  // разметке, где она задана числом строк. Измерение здесь было лишним
  // звеном — а лишнее звено и оказалось тем, что ломалось.
  if (expected === "") {
    node.style.height = "";
    node.style.overflowY = "hidden";
    return;
  }

  node.style.height = "auto";
  const line = Number.parseFloat(getComputedStyle(node).lineHeight) || 21;
  const borders = node.offsetHeight - node.clientHeight;
  const needed = node.scrollHeight;
  const limit = Math.round(line * MAX_ROWS);

  node.style.height = `${Math.min(needed, limit) + borders}px`;
  // Прокрутка включается ТОЛЬКО когда поле упёрлось в предел. Иначе
  // дробная высота строки (21.75px) даёт расхождение в один пиксель,
  // и на одной-единственной строке появляется полоса прокрутки.
  // Гоняться за этим пикселем бесполезно — он зависит от шрифта.
  node.style.overflowY = needed > limit ? "auto" : "hidden";
}

/**
 * Строка над полем: на что отвечаем либо что правим.
 *
 * ⚠️ ОДНО МЕСТО НА ДВА СОСТОЯНИЯ, И ЭТО НЕ ЭКОНОМИЯ. Ответ и правка
 * взаимно исключают друг друга — нельзя править реплику, одновременно
 * отвечая на другую, — а две полоски друг над другом как раз и обещали бы,
 * что можно.
 */
function Above({
  replying,
  editing,
  onCancel,
}: {
  replying: Цитата | null;
  editing: Message | null;
  onCancel: () => void;
}) {
  if (!replying && !editing) return null;

  return (
    <div className="mb-1 flex items-center gap-2 border-b border-line pb-1">
      {editing ? (
        <>
          <Pencil className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-mark font-medium text-accent-ink">Изменение сообщения</span>
            <span className="truncate text-aside text-muted">{editing.body}</span>
          </span>
        </>
      ) : replying ? (
        <span className="min-w-0 flex-1">
          <Quote quote={replying} />
        </span>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        aria-label="Отменить"
        title="Отменить (Esc)"
        className="grid size-7 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Composer({
  onSend,
  replying,
  onCancelReply,
  editing,
  onCancelEdit,
  onSaveEdit,
}: {
  onSend: (body: string, clientMsgId: string) => Promise<void>;
  replying: Цитата | null;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const draftId = useRef(crypto.randomUUID());

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
      setText(editing.body);
      field.current?.focus();
    } else {
      setText("");
    }
  }, [editing?.id]);

  const field = useRef<HTMLTextAreaElement>(null);

  /**
   * Взяли реплику в ответ — курсор сразу в поле.
   *
   * ⚠️ СЛЕДУЮЩИМ КАДРОМ, А НЕ СРАЗУ. Меню по правой кнопке доигрывает
   * закрытие ПОСЛЕ обработчика пункта и уводит фокус — сначала на само
   * сообщение, а с запретом на это — на `body`. Наш вызов, сделанный
   * в тот же миг, просто затирался. Отсюда кадр задержки: он ничего
   * не «чинит наугад», он ставит нас в очередь ПОСЛЕ библиотеки.
   * Найдено измерением: `document.activeElement` показывал `BODY`.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: важен факт появления цитаты, а не её поля
  useEffect(() => {
    if (!replying) return;
    // Три попытки на протяжении полутора десятых секунды. Одного кадра
    // не хватило: замер показал `BODY` даже через 400 мс — меню возвращает
    // фокус не одним действием, а цепочкой отложенных. Спорить с чужим
    // расписанием по одной точке бессмысленно, поэтому мы просто
    // настойчивее: как только поле получило фокус, попытки прекращаются.
    const timers = [0, 60, 150].map((delay) =>
      setTimeout(() => {
        if (document.activeElement !== field.current) field.current?.focus();
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [replying?.id]);

  /**
   * Высота подгоняется ПОСЛЕ отрисовки и на каждое изменение текста.
   *
   * Раньше `fit` звался руками сразу за `setText("")` — то есть до того,
   * как React успевал очистить поле. Мерилась старая высота, и после
   * отправки многострочного сообщения поле оставалось раздутым.
   * Найдено владельцем на живом прогоне.
   *
   * Одно место вместо трёх вызовов: подгонка следует за состоянием,
   * а не за событиями, и разойтись с ним больше не может.
   */
  useLayoutEffect(() => {
    if (field.current) fit(field.current, text);
  }, [text]);

  /**
   * Отправить.
   *
   * ⚠️ ПОЛЕ ОЧИЩАЕТСЯ СРАЗУ И НИЧЕГО НЕ ЖДЁТ. Раньше оно ждало ответа
   * сервера, а неудачу показывало полосой над собой — «Сообщение не ушло».
   * Так не делает ни один мессенджер: полоса говорит о СОБЫТИИ, а сломаться
   * может конкретная реплика, и человеку нужно видеть какая. Теперь реплика
   * встаёт в ленту сразу с часиками, а её судьба помечается на ней же
   * (владелец, замечание с экрана).
   *
   * Ключ идемпотентности меняется здесь же: следующее сообщение — другое.
   * Повтор неудавшегося пойдёт со СТАРЫМ ключом из самой реплики, когда
   * повтор появится.
   */
  function submit(): void {
    const body = text.trim();
    if (!body) return;

    // Правка — не отправка: у неё нет ни ключа идемпотентности, ни места
    // в конце ленты. Одна кнопка на два действия, потому что для человека
    // это одно место, куда он пишет.
    if (editing) {
      void onSaveEdit(body);
      return;
    }

    const key = draftId.current;
    draftId.current = crypto.randomUUID();
    setText("");
    field.current?.focus();
    void onSend(body, key);
  }

  /** Разметка сочетанием клавиш. Вернёт true, если сочетание сработало. */
  function marked(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!event.ctrlKey && !event.metaKey) return false;
    const rule = WRAPS[event.code];
    if (!rule || rule.shift !== event.shiftKey) return false;

    const node = field.current;
    if (!node) return false;

    event.preventDefault();
    const { text: next, at } = wrap(node, rule.with);
    setText(next);
    // Курсор ставим ПОСЛЕ отрисовки: до неё в поле ещё старое значение,
    // и позиция уехала бы на длину вставленных знаков.
    requestAnimationFrame(() => node.setSelectionRange(at, at));
    return true;
  }

  /** Escape снимает и ответ, и правку — то же, что крестик в строке выше. */
  function escaped(event: React.KeyboardEvent): boolean {
    if (event.key !== "Escape" || (!replying && !editing)) return false;
    event.preventDefault();
    if (editing) onCancelEdit();
    else onCancelReply();
    return true;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (marked(event) || escaped(event)) return;
    // Enter отправляет, Shift+Enter переносит строку — как во всех
    // переписках. Composing — набор через IME (китайский, японский):
    // там Enter подтверждает иероглиф, а не отправляет сообщение.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      /* ⚠️ ТА ЖЕ ПОВЕРХНОСТЬ, ЧТО И ЛЕНТА, И ОДНА ЛИНИЯ СВЕРХУ. Своя
         заливка здесь уже была и читалась плашкой, приклеенной снизу
         (владелец, замечание с экрана): у Телеграма низ экрана — то же
         полотно, что и переписка, а границу обозначает одна волосяная
         линия, и та скорее тень, чем рамка.

         Поля по бокам меньше, чем у ленты: строка набора должна быть
         не уже строки чтения, иначе набранное «сжимается» на глазах. */
      className="border-t border-line bg-bg px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Above
        replying={replying}
        editing={editing}
        onCancel={editing ? onCancelEdit : onCancelReply}
      />
      <div className="flex items-end gap-2">
        <textarea
          ref={field}
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={editing ? "Изменить сообщение" : "Написать в канал"}
          aria-label="Текст сообщения"
          maxLength={8000}
          /* ⚠️ НИ РАМКИ, НИ СВОЕЙ ЗАЛИВКИ, НИ КОЛЬЦА ФОКУСА. Поле — это
             вся полоса, а не коробка внутри полосы: в Телеграме курсор
             просто стоит на белом, и очертить его нечем. Рамка здесь
             обводила то, что и так единственное место для набора,
             и мешала (владелец, замечание с экрана). */
          className="max-h-56 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-body leading-normal text-ink outline-none placeholder:text-muted"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={text.trim().length === 0}
          aria-label={editing ? "Сохранить" : "Отправить"}
          title={editing ? "Сохранить (Enter)" : "Отправить (Enter)"}
          className="rounded-pill"
        >
          <SendHorizontal />
        </Button>
      </div>
    </form>
  );
}
