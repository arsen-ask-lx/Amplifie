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
import { WRAPS, wrap } from "./compose.js";

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
 * ⚠️ ОТМЕНА И ПОВТОР — ЧЕРЕЗ `execCommand`, ХОТЯ ОН И ОБЪЯВЛЕН УСТАРЕВШИМ.
 * Это единственный способ тронуть РОДНУЮ стопку отмены поля. Своя стопка
 * означала бы, что Ctrl+Z и пункт меню отменяют разное — а это хуже,
 * чем устаревший вызов.
 */

/** Что умеет поле. Всё — над настоящим узлом, а не над состоянием React. */
function act(field: HTMLTextAreaElement | null, what: string): void {
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
async function paste(field: HTMLTextAreaElement | null): Promise<void> {
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

const MARKS: Array<{ code: keyof typeof WRAPS; label: string; Icon: typeof TextB }> = [
  { code: "KeyB", label: "Жирный", Icon: TextB },
  { code: "KeyI", label: "Курсив", Icon: TextItalic },
  { code: "KeyU", label: "Подчёркнутый", Icon: TextUnderline },
  { code: "KeyX", label: "Зачёркнутый", Icon: TextStrikethrough },
  { code: "KeyM", label: "Моноширинный", Icon: TextAa },
  { code: "KeyP", label: "Скрытый", Icon: Selection },
];

export function FieldMenu({
  field,
  onMark,
  children,
}: {
  field: React.RefObject<HTMLTextAreaElement | null>;
  /** Обёрнутый текст возвращается наверх: состояние поля держит React. */
  onMark: (next: string, at: number) => void;
  children: React.ReactNode;
}) {
  function mark(code: keyof typeof WRAPS) {
    const node = field.current;
    const rule = WRAPS[code];
    if (!node || !rule) return;
    node.focus();
    const { text, at } = wrap(node, rule.with);
    onMark(text, at);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => act(field.current, "undo")}>
          <ArrowArcLeft />
          Отменить
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act(field.current, "redo")}>
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
            {MARKS.map(({ code, label, Icon }) => (
              <ContextMenuItem key={code} onSelect={() => mark(code)}>
                <Icon />
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onSelect={() => act(field.current, "selectAll")}>
          <Selection />
          Выбрать всё
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
