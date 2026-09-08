import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// @ts-expect-error — плагин на чистом JS, без объявлений типов. Заводить
// их ради дев-оснастки, которая в продукт не попадает, — лишний файл,
// который придётся держать в согласии с кодом.
import { aimNotes } from "../tools/dev/aim-notes.mjs";

/** Адрес сервера для дев-режима. Значение по умолчанию — стек из compose. */
const API = process.env.API_URL ?? "http://localhost:8477";

export default defineConfig({
  // Плагин даёт быстрое обновление при правке. Без него JSX собирается,
  // но каждая правка перезагружает страницу целиком.
  plugins: [react(), tailwind(), aimNotes()],
  // Тот же короткий путь, что в tsconfig: его ждёт CLI набора компонентов,
  // и без него скопированные исходники не соберутся.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Собранная статика отдаётся Caddy — своего сервера у фронта нет.
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // Windows + bind-mount: без опроса HMR не видит изменений.
    watch: { usePolling: true },
    // Куда уходят запросы к серверу. По умолчанию — Caddy из compose,
    // то есть бек в контейнере. Если бек подняли на этой же машине
    // (`make dev-api`), адрес другой — отсюда переменная, а не константа.
    //
    // ⚠️ ПРОКСИ ЗДЕСЬ НЕ РАДИ УДОБСТВА. Сеанс живёт в печеньке HttpOnly;
    // ходи браузер напрямую на другой порт — это был бы чужой источник,
    // и печенька не поехала бы. Через прокси всё выглядит как один адрес.
    proxy: { "/v1": API, "/health": API },
  },
});
