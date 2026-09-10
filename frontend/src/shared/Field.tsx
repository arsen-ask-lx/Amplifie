import { useId } from "react";
import { Input } from "./ui/input.js";

interface FieldProps {
  label: string;
  /**
   * Имя поля для браузера.
   *
   * ⚠️ БЕЗ НЕГО НЕ РАБОТАЕТ АВТОЗАПОЛНЕНИЕ ПОЧТЫ. Браузер узнаёт форму
   * входа по паре «поле имени + поле пароля», и `name` участвует в этой
   * догадке наравне с `autocomplete`. Пароль он находит по типу, а почту —
   * нет: без имени поле для него безымянная строка. Замечено владельцем:
   * подстановка предлагалась только на пароле.
   */
  name?: string;
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
export function Field({ label, name, value, onChange, error, type, autoComplete }: FieldProps) {
  const generatedId = useId();
  const id = name ?? generatedId;

  return (
    <label className="mb-4 block" htmlFor={id}>
      <span className="mb-1 block text-aside text-muted">{label}</span>
      <Input
        type={type ?? "text"}
        id={id}
        name={name ?? autoComplete}
        autoComplete={autoComplete ?? "off"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        aria-invalid={error ? "true" : undefined}
      />
      {error ? <span className="mt-1 block text-aside text-danger">{error}</span> : null}
    </label>
  );
}
