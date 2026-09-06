/**
 * Тема: тёмная, светлая или как в системе.
 *
 * ПОЧЕМУ ЧЕРЕЗ АТРИБУТ, А НЕ ЧЕРЕЗ `prefers-color-scheme`. Медиазапрос
 * отвечает на вопрос «что выбрано в системе», а человеку нужно ответить
 * на другой: «что выбрал я здесь». Совместить их одним медиазапросом
 * нельзя — пришлось бы дублировать всю палитру, и две копии разъехались бы
 * при первой же правке.
 *
 * Поэтому источник правды один — атрибут `data-theme` на корне документа.
 * Системную настройку читаем сами и переводим в тот же атрибут.
 *
 * ⚠️ Ставится ДО отрисовки, в `main.tsx`. Иначе первый кадр будет светлым
 * у того, кто сидит в тёмной, — и это видно.
 */

export type Choice = "система" | "светлая" | "тёмная";

const KEY = "amplifie.тема";
const CHOICES: Choice[] = ["система", "светлая", "тёмная"];

/** Что выбрано. Испорченное или чужое значение — это «как в системе». */
export function chosen(): Choice {
  try {
    const saved = localStorage.getItem(KEY);
    return CHOICES.find((one) => one === saved) ?? "система";
  } catch {
    // Хранилище может быть закрыто настройками приватности. Тема — не то,
    // ради чего стоит падать: молча живём с системной.
    return "система";
  }
}

function systemIsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Применить выбор к документу. Возвращает то, что вышло на самом деле. */
export function apply(choice: Choice): "светлая" | "тёмная" {
  const real = choice === "система" ? (systemIsDark() ? "тёмная" : "светлая") : choice;
  document.documentElement.dataset.theme = real === "тёмная" ? "dark" : "light";
  // Браузер рисует по этому свойству полосы прокрутки и поля ввода.
  // Без него они останутся из другой темы, и это будет заметно.
  document.documentElement.style.colorScheme = real === "тёмная" ? "dark" : "light";
  return real;
}

export function remember(choice: Choice): void {
  try {
    if (choice === "система") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Не сохранилось — тема продержится до перезагрузки. Говорить об этом
    // человеку нечем и незачем: он увидит результат сразу, а забывчивость
    // заметит потом. Молчание здесь осознанное, а не проглоченная ошибка.
  }
}

/** Следующий выбор по кругу: система → светлая → тёмная → система. */
export function next(choice: Choice): Choice {
  return CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length] ?? "система";
}

/**
 * Следить за системной настройкой, пока выбрана «система».
 *
 * Человек меняет тему в системе по расписанию — приложение обязано
 * поехать следом, не дожидаясь перезагрузки страницы.
 */
export function watchSystem(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
