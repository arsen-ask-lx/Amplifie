import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
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

/**
 * Клавиши поля ввода: отправка, перенос строки и разметка по выделению.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `RichField`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов проходит по вопросу, а не по числу строк: здесь — «что делает
 * нажатие клавиши», в `RichField` — «из чего собрано поле». Первый
 * вопрос за месяц оброс тремя разобранными ошибками подряд, и каждая
 * стоит абзаца рядом с кодом.
 */

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
export function markSelection(editor: LexicalEditor, format: TextFormatType): void {
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
export function Handle({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
}

/** Enter, Shift+Enter и сочетания разметки. */
export function Keys({ onSend }: { onSend: () => void }) {
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
