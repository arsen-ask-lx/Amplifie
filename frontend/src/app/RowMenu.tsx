import { DotsThree } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu.js";

/**
 * Три точки строки панели и её меню — одни у чата и у проекта.
 *
 * ⚠️ ОДНА КНОПКА НА ДВЕ СТРОКИ, А НЕ ДВЕ КОПИИ. У чата и проекта они
 * были переписаны дважды слово в слово — гейт повторов нашёл; разъехавшись,
 * они показали бы точки по-разному в соседних строках одной панели.
 *
 * ⚠️ ТОЧКИ ПОЯВЛЯЮТСЯ ПО НАВЕДЕНИЮ НА СВОЮ СТРОКУ, но остаются видимыми,
 * пока меню открыто или на них фокус. Иначе меню открывалось бы и тут же
 * теряло свою кнопку, а с клавиатуры до неё было бы не добраться вовсе.
 * `reveal` — класс наведения группы своей строки: Tailwind находит только
 * целые имена классов, поэтому он приходит готовой строкой.
 */
export function RowMenu({
  label,
  reveal,
  children,
}: {
  label: string;
  reveal: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={[
            "grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted transition-opacity",
            "hover:bg-selected hover:text-ink focus-visible:opacity-100",
            open ? "opacity-100" : `opacity-0 ${reveal}`,
          ].join(" ")}
        >
          <DotsThree className="size-4" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
