import { useEffect, useRef, useState } from "react";
import { Button } from "../shared/ui/button.js";

/**
 * Заведение канала или ветки — полем на месте, без окна поверх экрана.
 *
 * Окно ради одного поля заставляет человека дважды сменить фокус внимания
 * и закрыть его прежде, чем он увидит результат. Поле на месте показывает
 * итог там же, где было действие.
 *
 * Esc отменяет, Enter подтверждает — так ведёт себя всё остальное,
 * и заучивать отдельно нечего.
 */
export function NewRoom({
  label,
  placeholder,
  onCreate,
}: {
  label: string;
  placeholder: string;
  onCreate: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function close(): void {
    setOpen(false);
    setTitle("");
    setFailure(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) return;

    setBusy(true);
    setFailure(null);
    try {
      await onCreate(name);
      close();
    } catch {
      setFailure("Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="justify-start text-muted"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        ref={field}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        onBlur={() => {
          // Пустое поле, потерявшее фокус, закрывается само: оставлять
          // его открытым значит держать на экране мусор, который человек
          // уже мысленно закрыл.
          if (!title.trim()) close();
        }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={120}
        disabled={busy}
        className="h-8 w-full rounded border border-accent bg-bg px-2.5 text-body text-ink outline-none placeholder:text-muted"
      />
      {failure ? <p className="mt-1 text-aside text-danger">{failure}</p> : null}
    </form>
  );
}
