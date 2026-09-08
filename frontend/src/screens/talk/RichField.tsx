import { AutoLinkNode, LinkNode } from "@lexical/link";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
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
  $selectAll,
  COMMAND_PRIORITY_LOW,
  INSERT_LINE_BREAK_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  REDO_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { Handle, Keys, markSelection } from "./fieldKeys.js";
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

/**
 * Что показывает разметку. Классы наши, поведение — редактора.
 *
 * ⚠️ ЭТО НЕ КОПИЯ ВИДА ИЗ ЛЕНТЫ, А ЕГО ПАРА, и они обязаны сходиться
 * глазами: человек набирает здесь, а читает там. Разъедутся — набранное
 * будет выглядеть одним, а отправленное другим, и заметит это только он.
 *
 * `highlight` — это наш СКРЫТЫЙ текст (см. `markupNodes.ts`): в поле он
 * закрашен, но читаем, потому что скрывать текст от того, кто его сейчас
 * пишет, — бессмыслица. Закрашивается он в ленте.
 */
const LOOK = {
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline underline-offset-2",
    strikethrough: "line-through",
    code: "rounded-sm bg-current/12 px-1 py-0.5 font-mono text-[0.92em]",
    highlight: "rounded-sm bg-current/12 px-0.5 decoration-dotted underline underline-offset-2",
  },
  link: "text-link underline underline-offset-2",
};

/**
 * Что считать адресом прямо во время набора.
 *
 * ⚠️ ТОТ ЖЕ НАБОР СХЕМ, ЧТО У РАЗБОРЩИКА ЛЕНТЫ, и это не совпадение:
 * подсветить в поле то, что лента ссылкой не считает, — обещание, которое
 * не сдержится после отправки.
 */
const URL_MATCHERS = [
  (text: string) => {
    const found = /https?:\/\/[^\s<>()]+/u.exec(text);
    if (!found) return null;
    const at = found.index;
    // Хвостовая пунктуация к адресу не относится: «см. http://a.b.»
    const url = found[0].replace(/[.,!?;:»"']+$/u, "");
    return { index: at, length: url.length, text: url, url };
  },
];

/**
 * Вернуть фокус в поле ПОСЛЕ того, как меню доиграет закрытие.
 *
 * ⚠️ ТРЕМЯ ПОПЫТКАМИ, И ЭТО НЕ ПЕРЕСТРАХОВКА. Меню по правой кнопке
 * возвращает фокус на свой узел не одним действием, а цепочкой отложенных
 * — уже после того, как отработал обработчик пункта. Один вызов `focus()`
 * успевает раньше этой цепочки, и она его отменяет. То же место и та же
 * причина, что у «Ответить» в `Composer.tsx`.
 */
function focusSoon(editor: LexicalEditor): void {
  for (const delay of [0, 60, 150]) setTimeout(() => editor.focus(), delay);
}

export interface FieldApi {
  focus: () => void;
  clear: () => void;
  fill: (markup: string) => void;
  format: (format: TextFormatType) => void;
  /** Отменить и повторить — СТОПКОЙ РЕДАКТОРА, а не браузера. */
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
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
        // Узлы ссылки объявляются заранее: редактор отказывается работать
        // с узлом, о котором его не предупредили при создании.
        nodes: [LinkNode, AutoLinkNode],
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
        {/* Адрес подсвечивается синим прямо во время набора — как везде. */}
        <AutoLinkPlugin matchers={URL_MATCHERS} />
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
              /**
               * ⚠️ ЧЕРЕЗ КОМАНДЫ РЕДАКТОРА, А НЕ ЧЕРЕЗ `execCommand`.
               * Раньше пункты меню звали `document.execCommand("undo"|"redo")`
               * — родную стопку отмены редактируемой области. У Lexical
               * такой стопки НЕТ: он перехватывает ввод и ведёт свою.
               * «Отменить» иногда срабатывало случайно, «Повторить» —
               * никогда, и владелец это поймал.
               *
               * Заодно исчезает расхождение: Ctrl+Z и пункт меню теперь
               * ходят в одну стопку, а не в две разные.
               */
              undo: () => {
                editor.dispatchCommand(UNDO_COMMAND, undefined);
                focusSoon(editor);
              },
              redo: () => {
                editor.dispatchCommand(REDO_COMMAND, undefined);
                focusSoon(editor);
              },
              /**
               * ⚠️ ВЫДЕЛЕНИЕ СТАВИТСЯ В СОСТОЯНИИ РЕДАКТОРА, А НЕ В DOM.
               * `execCommand("selectAll")` работает над тем, что выделено
               * в документе, — а в момент нажатия пункта меню фокус ещё
               * у меню, и выделялось либо ничего, либо вся страница.
               * Здесь выделение живёт в состоянии; фокус подтягивается
               * следом, и оно становится видимым.
               */
              selectAll: () => {
                editor.update(() => {
                  $selectAll();
                });
                focusSoon(editor);
              },
            })
          }
        />
      </div>
    </LexicalComposer>
  );
}
