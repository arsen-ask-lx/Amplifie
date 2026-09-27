/**
 * Разбор строки записи сессии (task-124). Форма строк — из живой записи Claude Code:
 * у сообщения человека `message.content` бывает строкой, а не списком блоков (27.09 —
 * 159 таких строк в одной записи).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shellCommandsOf } from "./session-log.mjs";

const line = (content) => JSON.stringify({ message: { content } });

describe("команды оболочки из строки записи", () => {
  it("вызовы Bash и PowerShell — их команды; прочие инструменты — нет", () => {
    const content = [
      { type: "tool_use", name: "Bash", input: { command: "git commit -m x" } },
      { type: "tool_use", name: "Read", input: { file_path: "a.md" } },
      { type: "tool_use", name: "PowerShell", input: { command: "git status" } },
    ];
    assert.deepEqual(shellCommandsOf(line(content)), ["git commit -m x", "git status"]);
  });

  it("содержимое строкой (сообщение человека) — пусто, а не падение хука коммита", () => {
    assert.deepEqual(shellCommandsOf(line("ок го")), []);
  });

  it("обрезанная строка в начале хвоста — пусто", () => {
    assert.deepEqual(shellCommandsOf('"tool_use","name":"Bash"}]}}'), []);
  });
});
