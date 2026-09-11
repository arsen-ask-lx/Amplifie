import { Plus } from "@phosphor-icons/react";

/**
 * Раздел боковой панели: подпись и список под ней.
 *
 * ⚠️ УСТРОЙСТВО ПЕРЕНЕСЕНО ИЗ BUZZ (`features/sidebar/ui/SidebarSection.tsx`),
 * а не придумано, и два приёма оттуда остались:
 *
 *   ① ДЕЙСТВИЕ ЖИВЁТ В ПОДПИСИ. Новый проект — это `+` справа в строке
 *      «Проекты», а не отдельная строка «+ Проект» внизу списка. Так
 *      в Buzz, в Слаке, в Дискорде и в Codex;
 *
 *   ② `+` ПО НАВЕДЕНИЮ. Список читают каждый день, а папку заводят
 *      изредка; кнопка, которую видно всегда, забирает внимание у того,
 *      ради чего раздел существует.
 *
 *      ⚠️ ЗАПИСЬ О КОЛЕБАНИИ, ЧТОБЫ НЕ ХОДИТЬ ПО КРУГУ. 10.09 плюс
 *      сделали постоянным — по сверке с Codex, где он стоит всегда.
 *      Владелец посмотрел на живом экране и вернул обратно: «пусть
 *      плюсик не видно, пока не наведёшь». Решает экран, а не снимок
 *      чужого продукта.
 *
 * Третий приём Buzz — подпись сворачивает раздел — снят 10.09 по слову
 * владельца: «убрать напротив проектов стрелочку». Разделов два,
 * сворачивать их незачем, а у каждой папки внутри своё сворачивание есть.
 * Так же в Codex.
 */
export function SidebarSection({
  title,
  onAdd,
  addLabel,
  addAlwaysVisible = false,
  children,
}: {
  title: string;
  /** Что делает `+` в подписи. Нет — подпись без действия. */
  onAdd?: () => void;
  addLabel?: string;
  /**
   * Показать `+` без наведения.
   *
   * ⚠️ НУЖНО ПУСТОМУ РАЗДЕЛУ. Когда проектов нет, плюс — единственный
   * вход в раздел, и прятать его значит прятать саму возможность:
   * на телефоне наведения не бывает вовсе, и первый проект было бы
   * нечем завести.
   */
  addAlwaysVisible?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex shrink-0 flex-col">
      <div className="flex items-center gap-1 pr-1">
        {/* ⚠️ ОБЫЧНЫЕ БУКВЫ РАЗМЕРОМ ПОДПИСИ ПАНЕЛИ, А НЕ МЕЛКИЙ КАПС
            (владелец 10.09: «вот эта надпись маленькая по-моему»). Ярлык
            вразрядку читают только при поиске глазами; здесь же подпись —
            заголовок списка. У Codex «Проекты» тоже набраны обычными буквами. */}
        <div className="group/section flex min-w-0 flex-1 items-center">
          <span className="min-w-0 flex-1 px-2.5 py-1 text-body text-muted">
            <span className="truncate">{title}</span>
          </span>

          {onAdd ? (
            <button
              type="button"
              aria-label={addLabel ?? "Добавить"}
              title={addLabel ?? "Добавить"}
              onClick={onAdd}
              className={[
                "grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted transition-opacity",
                "hover:bg-raised hover:text-ink focus-visible:opacity-100",
                addAlwaysVisible
                  ? "opacity-100"
                  : "opacity-0 group-focus-within/section:opacity-100 group-hover/section:opacity-100",
              ].join(" ")}
            >
              <Plus className="size-3.5" weight="bold" />
            </button>
          ) : null}
        </div>
      </div>

      {/* ⚠️ ПРОСВЕТ МЕЖДУ ПОДПИСЬЮ И СПИСКОМ ЗАДАЁТСЯ ЗДЕСЬ, А НЕ У СПИСКА.
          Без него подпись прилипает к первой строке (замечание владельца
          с экрана). Просвет — свойство пары «подпись плюс содержимое»:
          у списка нет причины знать, что над ним что-то есть. */}
      <div className="flex min-h-0 flex-col pt-1.5">{children}</div>
    </section>
  );
}
