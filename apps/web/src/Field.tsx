interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  type?: string;
  autoComplete?: string;
}

export function Field({ label, value, onChange, error, type, autoComplete }: FieldProps) {
  return (
    <>
      <label>
        <span>{label}</span>
        <input
          type={type ?? "text"}
          autoComplete={autoComplete ?? "off"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </label>
      {error ? <div className="err">{error}</div> : null}
    </>
  );
}
