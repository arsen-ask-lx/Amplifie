import { useRef, useState } from "react";

/**
 * Поле ввода сообщения.
 *
 * `clientMsgId` рождается в момент НАЧАЛА набора и живёт, пока сообщение
 * не ушло. Поэтому повторная отправка после разрыва — то же самое
 * сообщение, а не второе такое же: сервер узнаёт его по этому ключу.
 */
export function Composer({
  onSend,
}: {
  onSend: (body: string, clientMsgId: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const draftId = useRef(crypto.randomUUID());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
      setFailure("Сообщение не ушло. Нажмите «Отправить» ещё раз — оно не задвоится.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      {failure ? <p className="err">{failure}</p> : null}
      <div className="composer-row">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
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
