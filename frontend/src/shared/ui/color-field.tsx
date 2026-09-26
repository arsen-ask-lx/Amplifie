import { DEFAULT_PICK } from "../projectLookNames.js";
/**
 * Пипетка — третье поле продукта: поле формы, строка команды и выбор цвета.
 *
 * ⚠️ РОДНАЯ ПИПЕТКА БРАУЗЕРА, А НЕ СВОЁ КОЛЕСО (task-104). Она знает, как
 * выбирают цвет на этой системе, помнит недавние и открывается так, как
 * человек привык. Своё колесо пришлось бы рисовать, объяснять с клавиатуры
 * и чинить в каждой теме.
 *
 * ⚠️ САМО ПОЛЕ НЕВИДИМО, ВИДЕН КРУЖОК. Браузер рисует `input type="color"`
 * по-своему в каждой системе; кружок — наш, и он один во всех темах.
 */
export function ColorField({
  value,
  label,
  onChange,
}: {
  /** Выбранный цвет `#rrggbb`. Пусто — кружок показывает цвет по умолчанию. */
  value: string | null;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className="grid size-6 cursor-pointer place-items-center rounded-pill border border-edge"
      title={label}
    >
      <span className="sr-only">{label}</span>
      <input
        type="color"
        value={value ?? DEFAULT_PICK}
        aria-label={label}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        className="size-5 cursor-pointer rounded-pill border-0 bg-transparent p-0"
      />
    </label>
  );
}
