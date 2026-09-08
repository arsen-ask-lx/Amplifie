import { CaretDown, Plus } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * Сворачиваемая секция боковой панели.
 *
 * ⚠️ УСТРОЙСТВО ПЕРЕНЕСЕНО ИЗ BUZZ (`features/sidebar/ui/SidebarSection.tsx`),
 * а не придумано. Там оно решает ровно нашу задачу — «а если разделов
 * станет десять»: разделов наверху остаётся мало, а РАСТЁТ список внизу,
 * и растёт он секциями, которые человек сворачивает.
 *
 * Три приёма оттуда, и каждый по делу:
 *
 *   ① ЗАГОЛОВОК — КНОПКА. Нажатие сворачивает. Шеврон появляется только
 *      при наведении: пока не трогаешь, это просто подпись, а не элемент
 *      управления, требующий внимания;
 *
 *   ② ДЕЙСТВИЕ ЖИВЁТ В ЗАГОЛОВКЕ. Создание канала — это `+` справа
 *      в строке «Каналы», а не отдельная строка «+ Канал» внизу списка.
 *      Так в Buzz, так в Слаке, так в Дискорде. Отдельной строкой это
 *      было у нас, и это была выдумка;
 *
 *   ③ `+` ТОЖЕ ПО НАВЕДЕНИЮ. Канал заводят раз в месяц, а список читают
 *      каждый день. Кнопка, которую видно всегда, забирает внимание
 *      у того, ради чего секция существует.
 */
export function SidebarSection({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  /** Что делает `+` в заголовке. Нет — заголовок без действия. */
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    /* ⚠️ `flex-1` И `min-h-0` НА ВСЕЙ ЦЕПОЧКЕ, СВЕРХУ ДОНИЗУ. Прокрутка
       внутри колонки работает, только если КАЖДОЕ звено от неё до окна
       умеет сжиматься: у флекса минимальная высота по умолчанию равна
       содержимому, и одно звено без `min-h-0` распирает всю колонку.
       Список каналов из-за этого выезжал под профиль, а не прокручивался
       (замечание владельца). Оборвал цепочку я сам — отступом под
       подписью «КАНАЛЫ». */
    <section className="group/section flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((was) => !was)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded bg-transparent px-2.5 py-1 text-left text-mark tracking-wide text-muted uppercase transition-colors hover:text-ink"
        >
          <span className="truncate">{title}</span>
          <CaretDown
            aria-hidden="true"
            className={[
              "size-3 shrink-0 opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100",
              collapsed ? "-rotate-90" : "",
            ].join(" ")}
          />
        </button>

        {onAdd ? (
          <button
            type="button"
            aria-label={addLabel ?? "Добавить"}
            title={addLabel ?? "Добавить"}
            onClick={onAdd}
            className="grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100 hover:bg-raised hover:text-ink focus-visible:opacity-100"
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>

      {/* ⚠️ ОТСТУП МЕЖДУ ПОДПИСЬЮ И СПИСКОМ ЗАДАЁТСЯ ЗДЕСЬ, А НЕ У СПИСКА.
          Подпись «КАНАЛЫ» набрана мелко и вразрядку — она читается как
          ярлык к тому, что под ней, и без просвета прилипает к первой
          строке списка (замечание владельца с экрана). Просвет —
          свойство пары «подпись плюс её содержимое», а не самого списка:
          у списка нет причины знать, что над ним что-то есть. */}
      {collapsed ? null : <div className="flex min-h-0 flex-1 flex-col pt-1.5">{children}</div>}
    </section>
  );
}
