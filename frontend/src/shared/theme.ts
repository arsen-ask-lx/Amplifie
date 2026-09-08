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

export type Choice = "светлая" | "тёмная";

/**
 * Цвет акцента. Тем же приёмом, что и тема: атрибут на корне, а значения —
 * в `styles.css`.
 *
 * ⚠️ ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ СТОИТ В `index.html`, А НЕ ЗДЕСЬ. Атрибут уже
 * есть в разметке, поэтому первый кадр рисуется с акцентом даже до того,
 * как выполнится этот файл. В `:root` акцентной шкалы нет вовсе — иначе
 * у зелёного было бы две копии одних и тех же двенадцати чисел.
 */
export type Accent =
  | "монохром"
  | "зелёный"
  | "синий"
  | "фиолетовый"
  | "малиновый"
  | "янтарный"
  | "бирюзовый";

export const ACCENTS: Accent[] = [
  "монохром",
  "зелёный",
  "синий",
  "фиолетовый",
  "малиновый",
  "янтарный",
  "бирюзовый",
];

const KEY = "amplifie.тема";
const ACCENT_KEY = "amplifie.акцент";
const CHOICES: Choice[] = ["светлая", "тёмная"];

/**
 * Что выбрано. Ничего не выбрано или значение испорчено — берём системную
 * настройку ОДИН РАЗ, как отправную точку, и дальше она уже не следит.
 *
 * ⚠️ «Как в системе» было третьим состоянием и убрано владельцем. Разница
 * тонкая, но она есть: раньше приложение ЕХАЛО за системой по расписанию,
 * теперь оно только УГАДЫВАЕТ первый раз. Дальше выбор — человека.
 */
export function chosen(): Choice {
  try {
    const saved = localStorage.getItem(KEY);
    const known = CHOICES.find((one) => one === saved);
    if (known) return known;
  } catch {
    // Хранилище может быть закрыто настройками приватности. Тема — не то,
    // ради чего стоит падать.
  }
  return systemIsDark() ? "тёмная" : "светлая";
}

function systemIsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Применить выбор к документу. */
export function apply(choice: Choice): Choice {
  const real = choice;
  document.documentElement.dataset.theme = real === "тёмная" ? "dark" : "light";
  // Браузер рисует по этому свойству полосы прокрутки и поля ввода.
  // Без него они останутся из другой темы, и это будет заметно.
  document.documentElement.style.colorScheme = real === "тёмная" ? "dark" : "light";
  return real;
}

/** Какой акцент выбран. Ничего не выбрано — монохром. */
export function chosenAccent(): Accent {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    const known = ACCENTS.find((one) => one === saved);
    if (known) return known;
  } catch {
    // Хранилище закрыто настройками приватности — не повод падать.
  }
  return "монохром";
}

/** Применить акцент к документу. */
export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

export function rememberAccent(accent: Accent): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Как и с темой: продержится до перезагрузки, и это видно сразу.
  }
}

export function remember(choice: Choice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Не сохранилось — тема продержится до перезагрузки. Говорить об этом
    // человеку нечем и незачем: он увидит результат сразу, а забывчивость
    // заметит потом. Молчание здесь осознанное, а не проглоченная ошибка.
  }
}
