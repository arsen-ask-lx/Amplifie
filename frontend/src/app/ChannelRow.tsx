import { DotsThree, Hash, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { Conversation } from "../data/api.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";

/**
 * Строка канала в боковой панели.
 *
 * ⚠️ ВЫНЕСЕНА ИЗ `RoomList`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов по вопросу, а не по числу строк: `RoomList` отвечает на «из чего
 * состоит список и как в него добавляют», а это — на «как устроена одна
 * строка». Второй вопрос за задачу про непрочитанное оброс числом,
 * скрытым словом для чтения с экрана и плотностью названия.
 */

/**
 * Число непрочитанного у канала.
 *
 * ⚠️ ПОТОЛОК «999+», И ОН НЕ КОСМЕТИКА. Сервер считает не дальше тысячи
 * (Р-029): выше этого число уже ничего не сообщает человеку, а счёт
 * по огромному каналу стоит денег. Показываем ровно то, что посчитано.
 */
function Unread({ count }: { count: number }) {
  return (
    <span className="ml-auto shrink-0 rounded-pill bg-accent px-1.5 py-0.5 text-mark text-on-accent tabular-nums">
      {/* ⚠️ СЛОВО ДЛЯ ЧТЕНИЯ С ЭКРАНА, А НЕ `aria-label` НА `span`.
          Голая «7» вслух не говорит ничего, а `aria-label` на узле без
          роли браузеры и читалки имеют право не заметить — линтер прав.
          Спрятанное слово читается всегда и никому не мешает.

          Оно же входит в ДОСТУПНОЕ ИМЯ кнопки канала: «Совещание
          непрочитанных: 2». Поэтому в проверках канал ищется по началу
          имени, а не целиком (fixtures.ts). */}
      <span className="sr-only">непрочитанных: </span>
      {count > 999 ? "999+" : count}
    </span>
  );
}

/**
 * Строка канала: название и три точки справа.
 *
 * ⚠️ ТРИ ТОЧКИ, А НЕ ПРАВАЯ КНОПКА. Сначала действия висели на правой
 * кнопке — как у реплики в ленте. Владелец сказал прямо: неудобно, и он
 * прав. Правая кнопка не видна: о ней надо ЗНАТЬ. В ленте это терпимо —
 * там так у Телеграма, и человек приходит с этой привычкой; в боковой
 * панели привычка другая, её задали ChatGPT и Claude, и там действия
 * живут на трёх точках.
 *
 * ⚠️ ТОЧКИ ПОЯВЛЯЮТСЯ ПО НАВЕДЕНИЮ, но остаются видимыми, пока меню
 * открыто или на них фокус. Иначе меню открывалось бы и тут же теряло
 * свою кнопку, а с клавиатуры до неё было бы не добраться вовсе.
 *
 * ⚠️ ДВЕ КНОПКИ РЯДОМ, А НЕ КНОПКА В КНОПКЕ. Вложенная кнопка — неверная
 * разметка: браузер её распрямляет, и нажатие на точки выбирало бы канал
 * заодно.
 */
export function ChannelRow({
  channel,
  current,
  unread,
  onSelect,
  onRemove,
}: {
  channel: Conversation;
  current: boolean;
  /** Сколько чужих реплик человек тут не видел (Р-029). */
  unread: number;
  onSelect: (id: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={[
        "group/room flex items-center rounded pr-1 transition-colors",
        current ? "bg-selected" : "bg-transparent hover:bg-raised",
      ].join(" ")}
    >
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={() => onSelect(channel.id)}
        className={[
          "flex min-w-0 flex-1 items-center gap-2 rounded bg-transparent px-2.5 py-1.5 text-left text-body transition-colors",
          current ? "font-medium text-ink" : "text-muted group-hover/room:text-ink",
          // Название канала с непрочитанным набрано плотнее: у Телеграма
          // так же, и это второй признак помимо числа — тот, кто читает
          // панель по диагонали, замечает вес раньше цифры.
          unread > 0 && !current ? "font-medium text-ink" : "",
        ].join(" ")}
      >
        <Hash className="size-4 shrink-0 opacity-60" />
        <span className="truncate">{channel.title}</span>
        {/* ⚠️ ЧИСЛО ВНУТРИ КНОПКИ КАНАЛА, А НЕ РЯДОМ С НЕЙ. Оно про этот
            канал, и нажатие по нему обязано открывать его же — как
            и нажатие по названию. Отдельный узел снаружи означал бы
            мёртвую зону в строке. */}
        {unread > 0 ? <Unread count={unread} /> : null}
      </button>

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Что сделать с каналом «${channel.title}»`}
            className={[
              "grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted transition-opacity",
              "hover:bg-selected hover:text-ink focus-visible:opacity-100",
              open ? "opacity-100" : "opacity-0 group-hover/room:opacity-100",
            ].join(" ")}
          >
            <DotsThree className="size-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash />
            Удалить канал
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
