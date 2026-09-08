/**
 * Механика поля ввода: высота под текст и обёртки разметки.
 *
 * Отдельно от самого поля (гейт размера файла): здесь чистые функции,
 * которые проверяются без экрана, а в `Composer.tsx` остаётся то, что
 * без экрана не проверить.
 */

/** Дальше поле не растёт, а прокручивается: иначе оно съест ленту. */
const MAX_ROWS = 10;

/**
 * Сочетания клавиш для разметки — те же, что у Телеграма на десктопе.
 *
 * ⚠️ СВОИХ НЕ ПРИДУМЫВАЕМ. Горячая клавиша полезна ровно тем, что её уже
 * знают: Ctrl+B, Ctrl+I, Ctrl+U — общие для всех редакторов, а
 * Ctrl+Shift+X, Ctrl+Shift+M и Ctrl+Shift+P взяты у них один в один.
 *
 * Ключ — «нужен ли Shift» плюс буква. Буква латинская: при русской
 * раскладке браузер всё равно сообщает `code`, а не `key`, и проверять
 * по `key` значило бы сломать сочетания у всех, кто пишет по-русски.
 */
export const WRAPS: Record<string, { shift: boolean; with: string }> = {
  KeyB: { shift: false, with: "**" },
  KeyI: { shift: false, with: "*" },
  KeyU: { shift: false, with: "__" },
  KeyX: { shift: true, with: "~~" },
  KeyM: { shift: true, with: "`" },
  KeyP: { shift: true, with: "||" },
};

/**
 * Обернуть выделенное. Ничего не выделено — ставим пару и курсор внутрь:
 * так делают все редакторы, и это избавляет от «набрал, потом выделил».
 */
export function wrap(node: HTMLTextAreaElement, mark: string): { text: string; at: number } {
  const { value, selectionStart: from, selectionEnd: to } = node;
  const inside = value.slice(from, to);
  return {
    text: value.slice(0, from) + mark + inside + mark + value.slice(to),
    at: from + mark.length + inside.length,
  };
}

/**
 * Подогнать высоту поля под текст.
 *
 * Сброс в auto обязателен: без него поле умеет только расти и никогда
 * не сжимается обратно. Рамки прибавляются отдельно — `scrollHeight`
 * их не считает, и высота выходила на два пикселя короче нужной,
 * отчего на ОДНОЙ строке появлялась полоса прокрутки.
 */
export function fit(node: HTMLTextAreaElement, expected: string): void {
  // Меряем, только когда в поле УЖЕ нужное значение. Без этой проверки
  // можно посчитать высоту по старому тексту — ровно та ошибка, из-за
  // которой поле не сжималось после отправки многострочного сообщения.
  if (node.value !== expected) return;

  // Пустое поле не меряем вовсе: снимаем высоту и отдаём её обратно
  // разметке, где она задана числом строк. Измерение здесь было лишним
  // звеном — а лишнее звено и оказалось тем, что ломалось.
  if (expected === "") {
    node.style.height = "";
    node.style.overflowY = "hidden";
    return;
  }

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
