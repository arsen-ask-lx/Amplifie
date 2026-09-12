/** Личный размер текста: хранится в браузере, как и тема оформления. */
export const TEXT_SCALES = [90, 100, 110, 125] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

const KEY = "amplifie.размер-текста";
const BASE_SIZES = {
  "--fs-mark": 11,
  "--fs-aside": 12,
  "--fs-body": 14,
  "--fs-lead": 16,
  "--fs-head": 20,
  "--fs-brand": 24,
} as const;

export function chosenTextScale(): TextScale {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (TEXT_SCALES.includes(saved as TextScale)) return saved as TextScale;
  } catch {
    // Настройка действует в текущей вкладке, даже если хранение закрыто.
  }
  return 100;
}

/** Применить до первого рендера, чтобы размер не мигал после обновления. */
export function applyTextScale(scale: TextScale): void {
  for (const [name, size] of Object.entries(BASE_SIZES)) {
    document.documentElement.style.setProperty(name, `${(size * scale) / 100}px`);
  }
}

export function rememberTextScale(scale: TextScale): void {
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {
    // Приватный режим не должен лишать человека возможности читать крупнее.
  }
}
