import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  INSERT_LINE_BREAK_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
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
 * Виды, которые не уживаются с моноширинным (Р-028).
 *
 * ⚠️ У ТЕЛЕГРАМА ЭТО ОГРАНИЧЕНИЕ САМОЙ МОДЕЛИ ДАННЫХ, А НЕ ОФОРМЛЕНИЯ:
 * «bold, italic, underline, strikethrough, and spoiler entities can
 * contain and can be part of any other entities, **except pre and code**».
 * Мы копируем чат — значит копируем и это.
 */
const NOT_WITH_CODE: TextFormatType[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "highlight",
];

/**
 * Развести моноширинный с остальными видами прямо в поле.
 *
 * ⚠️ ЗАПРЕТ ЖИВЁТ ЗДЕСЬ, А НЕ В РАЗБОРЩИКЕ, И ЭТО ВЕСЬ ЕГО СМЫСЛ. Пока
 * его не было, поле спокойно накладывало жирный поверх моноширинного
 * и отправляло `` **`код`** `` — строку, которую не мог прочесть никто:
 * в ленте выходило жирное слово в кавычках. Владелец так это и описал —
 * «моноширинный перестаёт работать, когда типы перемешиваются».
 *
 * Молча выкидывать вид при ПОКАЗЕ было бы той же бедой, только позже:
 * человек набрал одно, а увидел другое. Здесь он видит, как жирный
 * снимается, — в тот же миг, своими глазами.
 *
 * ⚠️ ПО УЗЛАМ, А НЕ ПО ВЫДЕЛЕНИЮ ЦЕЛИКОМ. `selection.hasFormat` отвечает
 * «весь ли кусок такой», и на выделении, где жирная только половина,
 * он говорит «нет» — половина осталась бы жирной. Узлы к этому моменту
 * уже разрезаны по границам выделения самой `formatText`.
 */
function $separate(selection: ReturnType<typeof $getSelection>, format: TextFormatType): void {
  if (!$isRangeSelection(selection)) return;
  const conflicting = format === "code" ? NOT_WITH_CODE : (["code"] as TextFormatType[]);
  for (const node of selection.getNodes()) {
    if (!$isTextNode(node)) continue;
    for (const conflict of conflicting) {
      if (node.hasFormat(conflict)) node.toggleFormat(conflict);
    }
  }
}

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
    $separate(selection, format);

    /**
     * ⚠️ ВЫДЕЛЕНИЕ ОСТАЁТСЯ, А НЕ СХЛОПЫВАЕТСЯ, И ЭТО ПЕРЕМЕНА (task-021).
     *
     * Раньше здесь курсор ставился в конец помеченного куска, а признак
     * с него снимался — лекарство от «нажал Ctrl+B и всё дальше жирное».
     * Лекарство лечило, но отрезало главное: ВТОРОЙ вид наложить было
     * не на что. Пометил слово жирным — выделения больше нет, и Ctrl+I
     * ничего не делает; чтобы получить жирный курсив, слово приходилось
     * выделять заново. Владелец на это и наткнулся, назвав «перестаёт
     * работать, когда типы перемешиваются».
     *
     * Болезнь при этом не возвращается: «режим» включается только на
     * ПУСТОМ выделении, а такое мы отвергаем строкой выше. Пока кусок
     * выделен, признак принадлежит ему, а не полю.
     */
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

    /**
     * ⚠️ ESCAPE НЕ ИМЕЕТ ПРАВА ВЫБИВАТЬ ИЗ ПОЛЯ, И ЭТО ПОЙМАНО ЖИВЫМ
     * ОБХОДОМ, А НЕ ПРИДУМАНО. Chrome уводит фокус из редактируемой
     * области на страницу. Снаружи это не видно ничем: поле выглядит
     * прежним, а буквы, которые человек печатает дальше, не появляются
     * нигде. В ленте после такого оказалась реплика, где хвост фразы
     * встал ПЕРЕД началом.
     *
     * ⚠️ ЛОВИМ САМ УХОД, А НЕ ОТМЕНЯЕМ НАЖАТИЕ. Проверено обе дороги:
     * `preventDefault` на нажатии Chrome не слушает, а возврат фокуса
     * следующим тактом опаздывает — первая же буква после Escape уходит
     * в никуда («и Пётр тоже» превращалось в «и Пётртоже»). Работает
     * только возврат ВНУТРИ события ухода: он успевает до следующего
     * нажатия.
     *
     * Флажок обязателен: уход бывает и законным — человек щёлкнул мимо
     * поля или ушёл в другое окно. Возвращать фокус в таких случаях
     * значило бы не отпускать человека из поля вовсе.
     */
    let byEscape = false;
    const offEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        byEscape = true;
        // Возвращаем `false`: клавишу себе не забираем — отмену ответа
        // и правки слушает то же нажатие выше по дереву.
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    const restore = () => {
      if (!byEscape) return;
      byEscape = false;
      editor.focus();
    };
    const offBlur = editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("blur", restore);
      root?.addEventListener("blur", restore);
    });

    return () => {
      offEnter();
      offKeys();
      offEscape();
      offBlur();
    };
  }, [editor, onSend]);

  return null;
}
