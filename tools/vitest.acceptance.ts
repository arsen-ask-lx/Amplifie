import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Корень — репозиторий, а не этот каталог: без строки ниже vitest
  // считает от места файла настроек и не находит ни одного теста.
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["backend/tests/**/*.test.ts"],
    // Приёмочные тесты бьют по ЖИВОМУ стеку через настоящий порт.
    // Никаких test client — арбитр обязан проверять поведение снаружи.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
