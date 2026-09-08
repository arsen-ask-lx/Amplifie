import {
  ArrowArcLeft,
  ArrowArcRight,
  Clipboard,
  Copy,
  Scissors,
  Selection,
  TextAa,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
  Trash,
} from "@phosphor-icons/react";
import type { TextFormatType } from "lexical";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../shared/ui/context-menu.js";
import type { FieldApi } from "./RichField.js";

/**
 * Меню правой кнопки в поле ввода — как в Телеграме.
 *
 * ⚠️ ОНО ЗАМЕНЯЕТ РОДНОЕ МЕНЮ БРАУЗЕРА, И ЭТО НЕ БЕСПЛАТНО. Вместе с ним
 * из поля уходят подсказки проверки орфографии: браузер показывает их
 * ровно в том меню, которое мы перекрыли. Сама проверка остаётся —
 * волнистая линия под словом никуда не девается, — но исправить опечатку
 * одним нажатием больше нельзя, только перепечатать. Телеграм это себе
 * позволяет, потому что он не в браузере и рисует подсказки сам.
 *
 * Названо здесь, а не забыто: если владелец решит, что подсказки важнее,
 * меню снимается одной строкой в `Composer.tsx`.
 *
 * ⚠️ ОТМЕНА, ПОВТОР И «ВЫБРАТЬ ВСЁ» ИДУТ ЧЕРЕЗ РЕДАКТОР, А НЕ ЧЕРЕЗ
 * `execCommand`. Сначала было наоборот, и это оказалось неверно дважды:
 * у Lexical своя стопка отмены — родную он не наполняет, поэтому
 * «Повторить» не делал НИЧЕГО (поймал владелец); а `selectAll` работает
 * над выделением в документе, которого в момент нажатия пункта меню нет
 * — фокус ещё у меню. Обе команды теперь живут в состоянии редактора,
 * и Ctrl+Z с пунктом меню ходят в одну стопку.
 *
 * Вырезать, копировать и удалить остались на `execCommand`: они работают
 * над УЖЕ выделенным, и это выделение переживает открытие меню.
 */

/** Что умеет поле. Всё — над настоящим узлом, а не над состоянием React. */
function act(field: FieldApi | null, what: string): void {
  if (!field) return;
  field.focus();
  document.execCommand(what);
}

/**
 * Вставка идёт через буфер обмена, а не `execCommand("paste")`.
 *
 * Браузеры запрещают программную вставку из соображений безопасности:
 * страница не должна читать буфер без ведома человека. Чтение через
 * `navigator.clipboard` спрашивает разрешение — а вот вставку в поле
 * делаем `insertText`, чтобы она попала в стопку отмены.
 */
async function paste(field: FieldApi | null): Promise<void> {
  if (!field) return;
  field.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand("insertText", false, text);
  } catch {
    // Человек не дал доступ к буферу — обычный ход, а не поломка.
    // Ctrl+V при этом работает: там вставляет браузер, а не мы.
  }
}

/**
 * Виды разметки. Скрытого здесь нет: у редактора нет своего признака
 * для него, а рисовать закрашенное прямо в поле — отдельная работа,
 * которую владелец не просил.
 */
const MARKS: Array<{ format: TextFormatType; label: string; Icon: typeof TextB }> = [
  { format: "bold", label: "Жирный", Icon: TextB },
  { format: "italic", label: "Курсив", Icon: TextItalic },
  { format: "underline", label: "Подчёркнутый", Icon: TextUnderline },
  { format: "strikethrough", label: "Зачёркнутый", Icon: TextStrikethrough },
  { format: "code", label: "Моноширинный", Icon: TextAa },
];

export function FieldMenu({
  field,
  children,
}: {
  field: React.RefObject<FieldApi | null>;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      {/* ⚠️ СВОЙ УЗЕЛ, А НЕ `asChild`. `asChild` отдаёт обработчики ПЕРВОМУ
          настоящему узлу внутри, а внутри у нас компонент редактора —
          свойства ему передать некуда, и меню молча не открывалось вовсе.
          Ширину узел забирает у полосы, чтобы правая кнопка работала
          по всему полю, а не по тексту в нём. */}
      <ContextMenuTrigger className="min-w-0 flex-1">{children}</ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => field.current?.undo()}>
          <ArrowArcLeft />
          Отменить
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => field.current?.redo()}>
          <ArrowArcRight />
          Повторить
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => act(field.current, "cut")}>
          <Scissors />
          Вырезать
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act(field.current, "copy")}>
          <Copy />
          Копировать
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void paste(field.current)}>
          <Clipboard />
          Вставить
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act(field.current, "delete")}>
          <Trash />
          Удалить
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TextAa />
            Форматирование
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            {MARKS.map(({ format, label, Icon }) => (
              <ContextMenuItem
                key={format}
                onSelect={() => {
                  field.current?.focus();
                  field.current?.format(format);
                }}
              >
                <Icon />
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onSelect={() => field.current?.selectAll()}>
          <Selection />
          Выбрать всё
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
