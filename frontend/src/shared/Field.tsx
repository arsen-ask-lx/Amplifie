interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  type?: string;
  autoComplete?: string;
}

/**
 * Поле формы: подпись, ввод и ошибка под ним.
 *
 * Подпись СВЕРХУ и всегда видна. «Плавающая» подпись внутри поля исчезает,
 * едва человек начал печатать, — и он перестаёт понимать, что заполняет,
 * ровно в тот момент, когда это важнее всего.
 *
 * Ошибка живёт под своим полем, а не общим списком наверху: список
 * заставляет искать, к чему относится строка.
 */
export function Field({ label, value, onChange, error, type, autoComplete }: FieldProps) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-aside text-muted">{label}</span>
      <input
        type={type ?? "text"}
        autoComplete={autoComplete ?? "off"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        aria-invalid={error ? "true" : undefined}
        className={[
          "h-9 w-full rounded-lg border bg-card px-3 text-body text-ink outline-none",
          error ? "border-danger" : "border-edge focus-visible:border-accent",
        ].join(" ")}
      />
      {error ? <span className="mt-1 block text-aside text-danger">{error}</span> : null}
    </label>
  );
}
