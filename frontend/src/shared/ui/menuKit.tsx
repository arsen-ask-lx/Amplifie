import type { ComponentType, ReactNode } from "react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./context-menu.js";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./dropdown-menu.js";

/**
 * Детали меню без привязки к тому, как оно открыто.
 *
 * ⚠️ ОДНИ ПУНКТЫ НА ДВА СПОСОБА ОТКРЫТЬ (владелец 26.09). У строки панели
 * меню открывается правой кнопкой и кнопкой настроек, а Radix требует для
 * них разные детали. Пункты, написанные дважды, разъехались бы на первой
 * же правке — поэтому пишутся один раз и получают набор деталей снаружи.
 */
export interface MenuKit {
  Content: ComponentType<{ className?: string; children: ReactNode }>;
  Item: ComponentType<{
    onSelect?: () => void;
    disabled?: boolean;
    variant?: "default" | "destructive";
    children: ReactNode;
  }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children: ReactNode }>;
}

export const contextKit: MenuKit = {
  Content: ContextMenuContent,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/** Кнопка настроек стоит у правого края строки — меню ровняется по нему же. */
function DropdownAtEnd(props: { className?: string; children: ReactNode }) {
  return <DropdownMenuContent align="end" {...props} />;
}

export const dropdownKit: MenuKit = {
  Content: DropdownAtEnd,
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};
