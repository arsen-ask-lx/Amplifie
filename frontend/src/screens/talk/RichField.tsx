import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  INSERT_LINE_BREAK_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { useEffect } from "react";
import { $fillFromMarkup, toMarkup } from "./markupNodes.js";

/**
 * Поле ввода с ВИДИМОЙ разметкой (Р-020).
 *
 * ⚠️ ЗВЁЗДОЧЕК БОЛЬШЕ НЕТ. Раньше жирный набирался как `**жирный**`
 * и превращался в жирный только в ленте: человек держал в голове две
 * картины — что набрано и что получится — и узнавал о промахе задним
 * числом. Теперь Ctrl+B делает текст жирным прямо здесь.
 *
 * ⚠️ ХРАНИМАЯ СТРОКА НЕ ИЗМЕНИЛАСЬ. Наружу отсюда уходит всё та же
 * `**жирный**` — исходная строка с разметкой (Р-002). Ни лента,
 * ни разборщик, ни сервер, ни база про этот файл не знают.
 *
 * ⚠️ ENTER ОТПРАВЛЯЕТ, SHIFT+ENTER ПЕРЕНОСИТ СТРОКУ — и перенос вставляется
 * ИМЕННО переводом строки, а не новым абзацем. Абзацы у нас негде хранить:
 * сообщение это строка, а не документ.
 */

/**
 * Внутренний отказ редактора.
 *
 * ⚠️ ПРОГЛАТЫВАЕТСЯ НАМЕРЕННО, И ПОТОМУ У НЕГО ЕСТЬ ИМЯ. Правило проекта
 * запрещает пустой `catch`, и правильно. Но пробросить отказ отсюда —
 * значит уронить весь экран разговора из-за поля ввода, а вывести
 * в консоль нельзя: печать в продукте запрещена другим правилом.
 * Имя делает решение видимым: `onError: тихо` читается как выбор.
 * Когда у нас появится приёмник происшествий, отказ поедет туда.
 */
function тихо(): void {
  // Тело намеренно пустое, и это сказано словами выше.
}

/** Что показывает разметку. Классы наши, поведение — редактора. */
const LOOK = {
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline underline-offset-2",
    strikethrough: "line-through",
    code: "rounded-sm bg-current/12 px-1 py-0.5 font-mono text-[0.92em]",
  },
};

/** Наши сочетания клавиш поверх редакторских. */
const KEYS: Record<string, { shift: boolean; format: TextFormatType }> = {
  KeyB: { shift: false, format: "bold" },
  KeyI: { shift: false, format: "italic" },
  KeyU: { shift: false, format: "underline" },
  KeyX: { shift: true, format: "strikethrough" },
  KeyM: { shift: true, format: "code" },
};

/**
 * Пометить ВЫДЕЛЕННОЕ и не залипнуть.
 *
 * ⚠️ БЕЗ ВЫДЕЛЕНИЯ НЕ ДЕЛАЕМ НИЧЕГО, и это главное. Редактор по умолчанию
 * понимает Ctrl+B на пустом выделении как «включить режим»: дальше всё
 * набранное идёт жирным, пока не выключишь. Владелец на это и наткнулся:
 * «нажал Ctrl+B и у меня остался шрифт жирным». Разметка у нас —
 * это свойство КУСКА ТЕКСТА, а не состояние поля.
 *
 * ⚠️ ПОСЛЕ ПОМЕТКИ РЕЖИМ СНИМАЕТСЯ. Даже когда выделение было, курсор
 * остаётся в конце помеченного куска и наследует его вид — и следующее
 * слово опять уходит жирным. Поэтому выделение схлопывается в конец,
 * а признак с него снимается: пометили слово — пишем дальше как писали.
 */
function markSelection(editor: LexicalEditor, format: TextFormatType): void {
  editor.update(() => {
    const selection = $getSelection();

    /**
     * ⚠️ ВСЁ ОДНИМ ОБНОВЛЕНИЕМ. Первая редакция сперва ЧИТАЛА выделение
     * отдельно, потом слала команду, потом правила выделение третьим
     * заходом — и разваливалась: прочитанное выделение к моменту команды
     * уже устаревало, проверка «есть ли выделение» давала ложь, и Ctrl+B
     * молча не делал ничего. Внутри одного обновления состояние одно
     * и то же от первой строки до последней.
     */
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

    selection.formatText(format);

    /**
     * ⚠️ СХЛОПЫВАЕМ В КОНЕЦ ВЫДЕЛЕНИЯ, А НЕ В «ФОКУС». Фокус — это тот
     * край, где отпустили мышь: при выделении СПРАВА НАЛЕВО он стоит
     * в НАЧАЛЕ, и курсор улетал в начало сообщения. Владелец поймал это
     * сразу; из кода не видно вовсе — в половине случаев всё верно.
     */
    const конец = selection.isBackward() ? selection.anchor : selection.focus;
    const { key, offset, type } = конец;
    selection.anchor.set(key, offset, type);
    selection.focus.set(key, offset, type);

    // И гасим унаследованный признак, иначе следующее слово будет таким же.
    if (selection.hasFormat(format)) selection.toggleFormat(format);
  });
}

/** Отдаёт редактор наружу: полю нужен и фокус, и очистка, и заполнение. */
function Handle({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
}

/** Enter, Shift+Enter и сочетания разметки. */
function Keys({ onSend }: { onSend: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const offEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        // Набор через IME (китайский, японский): там Enter подтверждает
        // иероглиф, а не отправляет сообщение.
        if (event?.isComposing) return false;
        if (event?.shiftKey) {
          event.preventDefault();
          editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
          return true;
        }
        event?.preventDefault();
        onSend();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    /**
     * Сочетания разметки.
     *
     * ⚠️ ЧЕРЕЗ КОМАНДУ РЕДАКТОРА, А НЕ ОБРАБОТЧИКОМ НА ЕГО УЗЛЕ. Первая
     * редакция вешала слушателя на `getRootElement()` — а его в момент
     * первого прохода ещё НЕТ: узел появляется, когда редактируемая
     * область смонтируется. Слушатель уходил в пустоту, и Ctrl+B молча
     * не работал. Команда же живёт у редактора, а не у узла.
     *
     * Сочетания читаются по `code`, а не по `key`: при русской раскладке
     * браузер сообщает букву раскладки, и Ctrl+B перестал бы работать
     * у всех, кто пишет по-русски.
     */
    const offKeys = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const rule = KEYS[event.code];
        if (!rule || rule.shift !== event.shiftKey) return false;
        event.preventDefault();
        markSelection(editor, rule.format);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      offEnter();
      offKeys();
    };
  }, [editor, onSend]);

  return null;
}

export interface FieldApi {
  focus: () => void;
  clear: () => void;
  fill: (markup: string) => void;
  format: (format: TextFormatType) => void;
}

export function RichField({
  placeholder,
  onChange,
  onSend,
  onReady,
}: {
  placeholder: string;
  /** Наружу уходит наша строка с разметкой, а не дерево редактора. */
  onChange: (markup: string) => void;
  onSend: () => void;
  onReady: (api: FieldApi) => void;
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "поле",
        theme: LOOK,
        onError: тихо,
      }}
    >
      <div className="relative min-w-0 flex-1">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Текст сообщения"
              spellCheck={true}
              /* ⚠️ `whitespace-pre-wrap` ОБЯЗАТЕЛЕН. Без него редактируемая
                 область схлопывает пробелы по правилам обычного HTML:
                 «обычный и жирный» превращалось в «обычныйижирный»,
                 а переносы строк не показывались вовсе. У простого поля
                 такой беды нет, и при переезде с него об этом легко
                 забыть — я и забыл. */
              className="field-scroll max-h-[45vh] min-h-[34px] overflow-y-auto px-1 py-2 text-body leading-normal whitespace-pre-wrap text-ink outline-none"
            />
          }
          // Подсказка рисуется НАД полем, а не атрибутом: у редактируемой
          // области нет `placeholder`, это не поле формы.
          placeholder={
            <span className="pointer-events-none absolute top-2 left-1 text-body text-muted select-none">
              {placeholder}
            </span>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin
          ignoreSelectionChange={true}
          onChange={(_, editor) => onChange(toMarkup(editor))}
        />
        <Keys onSend={onSend} />
        <Handle
          onReady={(editor) =>
            onReady({
              focus: () => editor.focus(),
              clear: () =>
                editor.update(() => {
                  $getRoot().clear();
                }),
              fill: (markup) => editor.update(() => $fillFromMarkup(markup)),
              format: (format) => markSelection(editor, format),
            })
          }
        />
      </div>
    </LexicalComposer>
  );
}
