import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/tests/**/*.test.ts"],
    // Приёмочные тесты бьют по ЖИВОМУ стеку через настоящий порт.
    // Никаких test client — арбитр обязан проверять поведение снаружи.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
