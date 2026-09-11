import {
  ArrowBendUpRight,
  ArrowUUpLeft,
  CheckSquare,
  Copy,
  LinkSimple,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import type { Message } from "../../data/api.js";
import { copyAndTell } from "../../shared/clipboard.js";
import { COPIED } from "../../shared/toast.js";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../shared/ui/context-menu.js";
import type { Row } from "./rows.js";

/** Что реплика умеет. Передаётся сверху: пузырь не ходит в данные сам. */
export interface Deeds {
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message, pinned: boolean) => void;
  onEdit: (message: Message) => void;
  onRemove: (message: Message) => void;
  /** Можно ли удалить: своё или модерирую здесь (Р-035). */
  canRemove: (message: Message) => boolean;
  /** Войти в режим выделения, начав с этой реплики. */
  onSelect: (message: Message) => void;
}

/** Что сейчас с выделением. `null` — режима выделения нет. */
export interface Picking {
  chosen: Set<string>;
  toggle: (message: Message) => void;
}

/**
 * Меню реплики по правой кнопке.
 *
 * ⚠️ ПОРЯДОК ПУНКТОВ ВЗЯТ У ТЕЛЕГРАМА, А НЕ ПРИДУМАН: ответить, изменить,
 * закрепить, копировать текст, копировать ссылку, переслать, удалить,
 * выделить. Он выглядит произвольным, но им пользуются миллионы рук,
 * и «Ответить» первым, а «Удалить» у самого низа — не вкус, а защита
 * от промаха.
 *
 * ⚠️ «ИЗМЕНИТЬ» — ТОЛЬКО У СВОИХ, «УДАЛИТЬ» — ЕЩЁ И У МОДЕРАТОРА (Р-035). Показать их у чужой
 * реплики и получить отказ от сервера — худшее из решений: меню обещает
 * то, чего нельзя, и человек узнаёт об этом уже после нажатия. Рубеж стоит
 * на сервере, а здесь — честный вид того же правила.
 *
 * Ссылка на реплику ведёт на `/c/<разговор>/<номер>` — тот самый адрес,
 * по которому лента доматывает до неё и подсвечивает.
 */
export function Actions({ row, deeds }: { row: Row; deeds: Deeds }) {
  const { message } = row;
  const pinned = message.pinnedAt !== null;

  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => deeds.onReply(message)}>
        <ArrowUUpLeft />
        Ответить
      </ContextMenuItem>

      {/* «Изменить» стоит вторым и есть только у своих — так у них. */}
      {row.mine ? (
        <ContextMenuItem onSelect={() => deeds.onEdit(message)}>
          <PencilSimple />
          Изменить
        </ContextMenuItem>
      ) : null}

      <ContextMenuItem onSelect={() => deeds.onPin(message, !pinned)}>
        {pinned ? <PushPinSlash /> : <PushPin />}
        {pinned ? "Открепить" : "Закрепить"}
      </ContextMenuItem>

      <ContextMenuItem onSelect={() => void copyAndTell(message.body, COPIED.text)}>
        <Copy />
        Копировать текст
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          void copyAndTell(
            `${window.location.origin}/c/${message.conversationId}/${message.seq}`,
            COPIED.link,
          )
        }
      >
        <LinkSimple />
        Копировать ссылку
      </ContextMenuItem>

      <ContextMenuItem onSelect={() => deeds.onForward(message)}>
        <ArrowBendUpRight />
        Переслать
      </ContextMenuItem>

      {deeds.canRemove(message) ? (
        <ContextMenuItem variant="destructive" onSelect={() => deeds.onRemove(message)}>
          <Trash />
          Удалить
        </ContextMenuItem>
      ) : null}

      <ContextMenuSeparator />

      <ContextMenuItem onSelect={() => deeds.onSelect(message)}>
        <CheckSquare />
        Выделить
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
