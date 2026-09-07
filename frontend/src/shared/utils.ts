import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Собрать классы и разрешить их спор.
 *
 * Нужен потому, что у Tailwind побеждает не последний класс в строке,
 * а тот, что стоит позже в собранном CSS. Строка `"p-2 p-4"` даёт
 * непредсказуемый отступ. `twMerge` выкидывает проигравшего заранее,
 * и «поверх компонента дописал класс» начинает работать так, как выглядит.
 */
export function cn(...parts: ClassValue[]): string {
  return twMerge(clsx(parts));
}
