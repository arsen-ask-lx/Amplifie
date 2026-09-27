/**
 * Цвет проекта и значок на нём (task-104). Написан ДО кода и обязан быть красным.
 *
 * ⚠️ ЭТО АРБИТР ВМЕСТО ГЕЙТА КОНТРАСТА. Пока цвета были набором имён, каждую
 * пару проверял `make contrast` по токенам темы. Пипетка отдаёт цвет, которого
 * никто заранее не видел, — проверять можно только ПРАВИЛО: значок на заливке
 * берётся тот, что читается, и берётся по арифметике WCAG, а не на глаз.
 */
import { describe, expect, it } from "vitest";
import { contrastRatio, inkOn, isProjectColor, PROJECT_PRESETS } from "./projectLook.js";

describe("цвет значка на заливке", () => {
  it("на тёмном — белый, на светлом — чёрный", () => {
    expect(inkOn("#0a0a0a")).toBe("#ffffff");
    expect(inkOn("#ffffff")).toBe("#000000");
    expect(inkOn("#f5e050")).toBe("#000000");
    expect(inkOn("#2c4a8c")).toBe("#ffffff");
  });

  it("выбранный значок читается на любом цвете: не ниже 3:1", () => {
    // Шаг по всему кубу RGB: ловушка — середина шкалы, где обе пары слабы.
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((one) => one.toString(16).padStart(2, "0")).join("")}`;
          expect(
            contrastRatio(inkOn(hex), hex),
            `значок не читается на ${hex}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("берёт лучшую из двух пар, а не первую подходящую", () => {
    // Серый ровно посередине: белый даёт 3.95, чёрный — 5.32.
    expect(inkOn("#808080")).toBe("#000000");
    expect(contrastRatio("#000000", "#808080")).toBeGreaterThan(
      contrastRatio("#ffffff", "#808080"),
    );
  });

  it("запись цвета — шесть знаков в нижнем регистре, остальное не цвет", () => {
    expect(isProjectColor("#3a7bd5")).toBe(true);
    expect(isProjectColor("#3A7BD5")).toBe(false);
    expect(isProjectColor("#abc")).toBe(false);
    expect(isProjectColor("красный")).toBe(false);
    expect(isProjectColor("#zzzzzz")).toBe(false);
    expect(isProjectColor("")).toBe(false);
  });

  it("готовые цвета — восемь, и каждый записан как цвет", () => {
    expect(PROJECT_PRESETS).toHaveLength(8);
    for (const preset of PROJECT_PRESETS) expect(isProjectColor(preset)).toBe(true);
    expect(new Set(PROJECT_PRESETS).size, "повторы в готовых цветах").toBe(8);
  });
});
