import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Быстрые проверки: чистые функции, без стека и без сети.
 *
 * Отдельный вход, а не флаг к приёмочным: те требуют `make up` и бьют
 * по настоящему порту. Смешать их значит либо потребовать стек ради
 * разбора строки, либо разучиться отличать «упало из-за кода»
 * от «упало, потому что стек не поднят».
 */
export default defineConfig({
  // Корень — репозиторий, а не этот каталог: без строки ниже vitest
  // считает от места файла настроек и не находит ни одного теста.
  root: fileURLToPath(new URL("..", import.meta.url)),
  /**
   * ⚠️ ОБЩИЙ ПАКЕТ — ИСХОДНИКОМ, КАК У СБОРЩИКА ФРОНТА (`frontend/vite.config.ts`).
   * Без этой строки проверки фронта брали старую сборку `dist`, где новых
   * функций ещё нет, и падали на исправном коде — та же порода, что белый
   * экран из-за разошедшегося списка значков (task-093).
   */
  resolve: {
    alias: {
      "@amplifie/contract": fileURLToPath(
        new URL("../packages/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // `packages` — тоже: без него тесты общего контракта не запускались
    // нигде, хотя лежали рядом с кодом и выглядели проверенными (task-093).
    include: ["{backend,frontend,bridge}/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
