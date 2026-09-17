import { type RefObject, useEffect } from "react";

/**
 * Закрыть слой поверх экрана: Escape и щелчок мимо.
 *
 * ⚠️ ОДНО ПРАВИЛО НА ВСЕ ТАКИЕ СЛОИ. Оно жило копией в окне пересылки,
 * и окно поиска (task-100) завело вторую — гейт повторов поймал её сразу.
 *
 * ⚠️ ЩЕЛЧОК МИМО СЛУШАЕТ ДОКУМЕНТ, А НЕ ПОДЛОЖКА. Обработчик на самой
 * подложке делает её интерактивной, не будучи кнопкой: программа чтения
 * экрана объявит её обычным блоком, а нажать с клавиатуры будет нечем.
 * Документ решает ту же задачу и никого не обманывает.
 */
export function useDismiss(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function outside(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", outside, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", outside, true);
    };
  }, [box, onClose]);
}
