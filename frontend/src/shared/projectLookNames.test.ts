import { PROJECT_PRESETS } from "@amplifie/contract";
import { describe, expect, it } from "vitest";
import { DEFAULT_PICK, PRESET_LABELS } from "./projectLookNames.js";

/**
 * Подписи готовых цветов идут по порядку палитры контракта (Д-66).
 * Сменится палитра — тест, а не молчаливая подпись «#abcdef» у кружка.
 */
describe("имена готовых цветов", () => {
  it("у каждого цвета палитры — своё слово, а не сам код цвета", () => {
    for (const hex of PROJECT_PRESETS) {
      expect(PRESET_LABELS[hex], `у ${hex} нет имени`).toMatch(/^[А-Яа-яЁё]+$/u);
    }
    expect(new Set(Object.values(PRESET_LABELS)).size).toBe(PROJECT_PRESETS.length);
  });

  it("пипетка по умолчанию — синий из палитры", () => {
    expect(PRESET_LABELS[DEFAULT_PICK]).toBe("Синий");
  });
});
