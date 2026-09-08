import { $createLinkNode, $isLinkNode } from "@lexical/link";
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

/**
 * Наши виды разметки ↔ признаки Lexical.
 *
 * ⚠️ СКРЫТЫЙ ТЕКСТ ЕДЕТ НА ПРИЗНАКЕ `highlight`, И ЭТО НЕ ПОДЛОГ.
 * Своего признака «скрытое» у редактора нет, а заводить ради него узел
 * — это своя сериализация, своя вставка и свой разбор буфера обмена.
 * `highlight` — единственный признак, которым мы больше нигде не
 * пользуемся, и весь его смысл задаётся НАШИМ классом в теме. Появится
 * настоящая подсветка — вот тогда и понадобится свой узел.
 *
 */
const AS_FORMAT: Partial<Record<string, TextFormatType>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
  code: "code",
  spoiler: "highlight",
  /**
   * ⚠️ БЛОК КОДА ЕДЕТ ТЕМ ЖЕ ПРИЗНАКОМ, ЧТО И МОНОШИРИННЫЙ. Раньше он
   * показывался в поле обычным текстом ВМЕСТЕ С ОГРАДОЙ — то есть человек
   * правил `` ``` `` руками, а моноширинного не видел.
   *
   * Обратно он собирается по числу строк: с переносом — оградой, без
   * переноса — кавычками. Значит блок в одну строку после правки станет
   * моноширинным куском в одну строку. Выглядит это одинаково, а разница
   * между «блоком в одну строку» и «куском в одну строку» существует
   * только у нас в разборщике — у Телеграма её нет.
   */
  pre: "code",
};

/** Чем обёрнут каждый вид при обратном превращении. */
const AS_MARKS: Array<{ format: TextFormatType; with: string }> = [
  { format: "code", with: "`" },
  { format: "bold", with: "**" },
  { format: "underline", with: "__" },
  { format: "strikethrough", with: "~~" },
  { format: "highlight", with: "||" },
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
    /**
     * ⚠️ ССЫЛКА СТАНОВИТСЯ УЗЛОМ ССЫЛКИ, А НЕ ПРОСТО ТЕКСТОМ. Раньше здесь
     * бралась только подпись, и адрес ТЕРЯЛСЯ МОЛЧА: реплика
     * `[договор](https://…)`, открытая на правку и сохранённая обратно,
     * превращалась в слово «договор» без адреса. Ни одна проверка этого
     * не видела — круг «строка → дерево → строка» на ссылках не гонялся.
     * Ровно то расхождение, о котором предупреждало Р-020.
     */
    if (token.kind === "link") {
      const link = $createLinkNode(token.href);
      link.append($createTextNode(token.text));
      paragraph.append(link);
      continue;
    }

    const node = $createTextNode(token.text);
    const format = AS_FORMAT[token.kind];
    if (format) node.toggleFormat(format);
    paragraph.append(node);
  }
  root.append(paragraph);
}

/**
 * Ссылка собирается обратно в нашу запись.
 *
 * Голый адрес остаётся голым: `[https://a](https://a)` — это тот же
 * адрес, записанный вчетверо длиннее, и разборщик всё равно превратит
 * голый в ссылку сам.
 */
function linkMarkup(node: unknown, text: string): string {
  const href = (node as { getURL: () => string }).getURL();
  return text === href ? text : `[${text}](${href})`;
}

/** Один кусок дерева → строка с обёртками. */
function markupOf(node: unknown): string {
  const text = (node as { getTextContent?: () => string }).getTextContent?.() ?? "";
  if (!text) return "";
  if ($isLinkNode(node as never)) return linkMarkup(node, text);

  // `hasFormat` есть только у текстовых узлов; у остальных обёрток нет.
  const marked = node as { hasFormat?: (f: TextFormatType) => boolean };
  if (!marked.hasFormat) return text;

  /**
   * ⚠️ МНОГОСТРОЧНЫЙ МОНОШИРИННЫЙ ОБЯЗАН УЕЗЖАТЬ ОГРАДОЙ, А НЕ КАВЫЧКАМИ.
   *
   * Одинарная кавычка у нас — разметка ОДНОЙ СТРОКИ, и разборщик через
   * перенос её намеренно не пускает: иначе случайная кавычка в начале
   * сообщения съедала бы полписьма до следующей. Но кусок текста с
   * переносами, помеченный моноширинным, честно заворачивался в кавычки —
   * и в ленте они оставались видны буквами, а моноширинного не было.
   * Владелец поймал это на длинном письме: реплика начиналась со знака
   * кавычки, дальше шли обычные абзацы.
   *
   * Ограда — та же разметка того же вида, только на несколько строк.
   */
  if (marked.hasFormat("code") && text.includes("\n")) return `\`\`\`${text}\`\`\``;

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
