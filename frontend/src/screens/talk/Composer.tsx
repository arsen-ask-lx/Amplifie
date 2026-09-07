import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/button.js";

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
 */

/** Дальше поле не растёт, а прокручивается: иначе оно съест ленту. */
const MAX_ROWS = 10;

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

export function Composer({
  onSend,
}: {
  onSend: (body: string, clientMsgId: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const draftId = useRef(crypto.randomUUID());
  const field = useRef<HTMLTextAreaElement>(null);

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

  async function submit(): Promise<void> {
    const body = text.trim();
    if (!body || busy) return;

    setBusy(true);
    setFailure(null);
    try {
      await onSend(body, draftId.current);
      // Ключ меняется только после успеха: если отправка не удалась,
      // человек жмёт ещё раз с ТЕМ ЖЕ ключом, и второго сообщения
      // не появится, даже если первое всё-таки дошло.
      draftId.current = crypto.randomUUID();
      setText("");
    } catch {
      setFailure("Сообщение не ушло. Отправьте ещё раз — оно не задвоится.");
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter отправляет, Shift+Enter переносит строку — как во всех
    // переписках. Composing — набор через IME (китайский, японский):
    // там Enter подтверждает иероглиф, а не отправляет сообщение.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form
      className="border-t border-line bg-bg px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? <p className="mb-2 text-aside text-danger">{failure}</p> : null}
      <div className="mx-auto flex max-w-[80ch] items-end gap-2">
        <textarea
          ref={field}
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Написать в канал"
          aria-label="Текст сообщения"
          maxLength={8000}
          className="max-h-56 min-h-9 flex-1 resize-none rounded-lg border border-edge bg-panel px-3 py-2 text-body leading-relaxed text-ink outline-none placeholder:text-muted focus-visible:border-accent"
        />
        <Button type="submit" disabled={busy || text.trim().length === 0}>
          Отправить
        </Button>
      </div>
    </form>
  );
}
