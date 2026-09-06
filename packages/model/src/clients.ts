import type { CliShape } from "./cli.js";

/**
 * Готовые наборы запуска официальных клиентов.
 *
 * Живут в общем пакете, потому что нужны обеим сторонам: серверу — когда
 * он запущен не в контейнере, мосту — всегда. Один список, а не два
 * разъезжающихся.
 */
export const KNOWN_CLIENTS: Record<string, Pick<CliShape, "command" | "args">> = {
  // -p: неинтерактивный режим, ответ уходит в стандартный вывод.
  "claude-cli": { command: "claude", args: ["-p"] },
  // exec с дефисом: то же у Codex, задание читается со стандартного ввода.
  "codex-cli": { command: "codex", args: ["exec", "-"] },
};
