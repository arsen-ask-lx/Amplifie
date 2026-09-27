import { marksIn } from "./searchLine.js";

/**
 * Подсветить найденные слова в уже нарисованном тексте (владелец 26.09:
 * «не подсвечиваем найденное слово»).
 *
 * ⚠️ ПОДСВЕТКА БРАУЗЕРОМ, А НЕ РАЗМЕТКОЙ. CSS Custom Highlight API красит
 * диапазоны текста, не трогая DOM: реплику не надо перерисовывать с `<mark>`,
 * а разбор разметки (жирный, код, упоминания) не знает о поиске вовсе.
 * Совпадение — то же правило, что у выдачи поиска (`marksIn`): начало слова,
 * без регистра, ё как е. Нет поддержки — нет подсветки, остальное работает.
 */
const NAME = "search-found";

export function highlightWords(root: Element, words: string[]): void {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    let offset = 0;
    for (const mark of marksIn(text, words)) {
      if (mark.hit) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + mark.text.length);
        ranges.push(range);
      }
      offset += mark.text.length;
    }
  }
  CSS.highlights.set(NAME, new Highlight(...ranges));
}

export function clearHighlight(): void {
  if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.delete(NAME);
}
