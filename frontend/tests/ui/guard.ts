import { test as base, expect } from "@playwright/test";

/**
 * Общий сторож интерфейсных сценариев (task-118): политика содержимого
 * ничего не запретила.
 *
 * ⚠️ ЗАЧЕМ В КАЖДОМ СЦЕНАРИИ, А НЕ ОДНИМ `csp.spec`. Запрещённый стиль или
 * шрифт видимо ничего не ломает: окно чуть не того вида, буква запасным
 * шрифтом — и сценарий зелёный. Браузер при этом пишет в консоль «Refused
 * to … Content Security Policy»; эту строку и ловим, во всех сценариях сразу.
 *
 * Сторожит страницу из `page`; страницы, открытые своим `newContext`,
 * сторож не видит.
 */
export * from "@playwright/test";

export const test = base.extend<{ cspGuard: undefined }>({
  cspGuard: [
    async ({ page }, use) => {
      const refused: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/iu.test(message.text())) refused.push(message.text());
      });
      await use(undefined);
      expect(refused, "политика содержимого запретила то, чем продукт пользуется").toEqual([]);
    },
    { auto: true },
  ],
});
