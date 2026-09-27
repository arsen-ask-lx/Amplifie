import { describe, expect, it } from "vitest";
import { escapeLabel, LABEL_SOURCE, unescapeLabel } from "./mentions.js";

/** Подпись в скобках (task-121): экранирование как в markdown, без потерь. */
const label = new RegExp(String.raw`^\[${LABEL_SOURCE}\]\(x\)$`, "u");
const read = (written: string) => label.exec(written)?.[1];

describe("подпись в скобках", () => {
  it("скобка и обратная черта в подписи доезжают целыми", () => {
    // Запись — руками, как её экранировал бы markdown, а не выходом escapeLabel.
    const cases: [name: string, written: string][] = [
      ["Анна]", "Анна\\]"],
      ["[админ] Павел", "\\[админ\\] Павел"],
      ["C:\\путь", "C:\\\\путь"],
      ["a\\]b", "a\\\\\\]b"],
      ["]", "\\]"],
    ];
    for (const [name, written] of cases) {
      expect(escapeLabel(name), name).toBe(written);
      expect(read(`[${written}](x)`), name).toBe(written);
      expect(unescapeLabel(written), name).toBe(name);
    }
  });

  it("старая запись без экранирования читается как прежде", () => {
    expect(unescapeLabel(read("[договор](x)") ?? "")).toBe("договор");
    // Обратная черта перед обычной буквой — не экранирование: остаётся как есть.
    expect(unescapeLabel(read("[C:\\path](x)") ?? "")).toBe("C:\\path");
  });

  it("неэкранированная скобка внутри подписи — не подпись", () => {
    expect(read("[a]b](x)")).toBeUndefined();
  });

  it("перевод строки в имени становится пробелом", () => {
    expect(escapeLabel("Анна\nМария")).toBe("Анна Мария");
  });
});
