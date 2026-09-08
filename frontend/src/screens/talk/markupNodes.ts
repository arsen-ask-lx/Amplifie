import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { parseMarkup } from "../../shared/markup.js";

/**
 * Превращение «наша строка ↔ дерево редактора».
 *
 * ⚠️ ЭТО САМОЕ ОПАСНОЕ МЕСТО ВО ВСЕЙ ЗАТЕЕ, и оно названо таким ещё
 * в Р-020 до кода. Текст теперь существует в двух видах: дерево, которое
 * человек правит, и строка, которая уходит на сервер. Пока превращение
 * туда-обратно не проверено, они разойдутся МОЛЧА — человек увидит одно,
 * а отправится другое. Поэтому здесь ничего, кроме превращения, и поэтому
 * рядом лежат проверки.
 *
 * ⚠️ РАЗБОР — ТОТ ЖЕ САМЫЙ, ЧТО У ЛЕНТЫ (`parseMarkup`). Второй разборщик
 * для поля ввода означал бы, что набранное и показанное разбираются
 * по разным правилам, и однажды они разойдутся на каком-нибудь углу.
 */

/** Наши виды разметки ↔ признаки Lexical. Ссылка и блок кода — особые. */
const AS_FORMAT: Partial<Record<string, TextFormatType>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
  code: "code",
};

/** Чем обёрнут каждый вид при обратном превращении. */
const AS_MARKS: Array<{ format: TextFormatType; with: string }> = [
  { format: "code", with: "`" },
  { format: "bold", with: "**" },
  { format: "underline", with: "__" },
  { format: "strikethrough", with: "~~" },
  { format: "italic", with: "*" },
];

/**
 * Строка → дерево. Зовётся при открытии правки и при вставке цитаты.
 *
 * Переводы строк остаются переводами строк: у нас одно поле, а не документ,
 * и абзацев в нём нет. Lexical хранит их как отдельные узлы внутри абзаца.
 */
export function $fillFromMarkup(text: string): void {
  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  for (const token of parseMarkup(text)) {
    const node = $createTextNode(token.kind === "link" ? token.text : token.text);
    const format = AS_FORMAT[token.kind];
    if (format) node.toggleFormat(format);
    // Скрытый и блок кода показываем обычным текстом: своих узлов для них
    // мы не заводим, пока владелец не скажет, что они нужны В ПОЛЕ.
    // В ленте они рисуются как положено — там разбор тот же.
    paragraph.append(node);
  }
  root.append(paragraph);
}

/** Один текстовый кусок → строка с обёртками. */
function markupOf(node: unknown): string {
  const text = (node as { getTextContent?: () => string }).getTextContent?.() ?? "";
  if (!text) return "";

  // `hasFormat` есть только у текстовых узлов; у остальных обёрток нет.
  const marked = node as { hasFormat?: (f: TextFormatType) => boolean };
  if (!marked.hasFormat) return text;

  let out = text;
  for (const { format, with: mark } of AS_MARKS) {
    if (marked.hasFormat(format)) out = `${mark}${out}${mark}`;
  }
  return out;
}

/**
 * Дерево → строка.
 *
 * ⚠️ ОБЁРТКИ НАКЛАДЫВАЮТСЯ В ТОМ ЖЕ ПОРЯДКЕ, В КАКОМ ИХ ЧИТАЕТ РАЗБОРЩИК.
 * У него ветки перебираются сверху вниз, и длинные обёртки стоят раньше
 * коротких; если написать здесь наоборот, `**жирный**` соберётся как
 * `*` плюс `*жирный*` плюс `*`, и разбор вернёт курсив внутри курсива.
 */
export function toMarkup(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => {
    const parts: string[] = [];
    for (const block of $getRoot().getChildren()) {
      const children = (block as { getChildren?: () => unknown[] }).getChildren?.() ?? [];
      for (const node of children) parts.push(markupOf(node));
    }
    return parts.join("");
  });
}
