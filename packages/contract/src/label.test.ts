import { describe, expect, it } from "vitest";
import { escapeLabel, LABEL_SOURCE, unescapeLabel } from "./mentions.js";

/** Подпись в скобках (task-121): экранирование как в markdown, без потерь. */
const label = new RegExp(String.raw`^\[${LABEL_SOURCE}\]\(x\)$`, "u");
const read = (written: string) => label.exec(written)?.[1];

describe("подпись в скобках", () => {
  it("скобка и обратная черта в подписи доезжают целыми", () => {
    for (const name of ["Анна]", "[админ] Павел", "C:\\путь", "a\\]b", "]"]) {
      const inside = read(`[${escapeLabel(name)}](x)`);
      expect(inside, name).toBeDefined();
      expect(unescapeLabel(inside ?? ""), name).toBe(name);
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
