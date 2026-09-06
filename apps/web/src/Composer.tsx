import { useLayoutEffect, useRef, useState } from "react";

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
function fit(node: HTMLTextAreaElement): void {
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

  // Подгоняем и при первом показе, и после каждой правки текста:
  // после отправки текст пуст, и поле обязано сжаться обратно.
  useLayoutEffect(() => {
    if (field.current) fit(field.current);
  }, []);

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
      if (field.current) fit(field.current);
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
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? <p className="err">{failure}</p> : null}
      <div className="composer-row">
        <textarea
          ref={field}
          value={text}
          rows={1}
          onChange={(event) => {
            setText(event.target.value);
            fit(event.target);
          }}
          onKeyDown={onKeyDown}
          placeholder="Написать в канал"
          aria-label="Текст сообщения"
          maxLength={8000}
        />
        <button type="submit" disabled={busy || text.trim().length === 0}>
          Отправить
        </button>
      </div>
    </form>
  );
}
