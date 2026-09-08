import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { agentUiKit } from "agent-ui-kit";
import { defineConfig } from "vite";

/** Адрес сервера для дев-режима. Значение по умолчанию — стек из compose. */
const API = process.env.API_URL ?? "http://localhost:8477";

export default defineConfig({
  // Плагин даёт быстрое обновление при правке. Без него JSX собирается,
  // но каждая правка перезагружает страницу целиком.
  plugins: [
    react(),
    tailwind(),
    // Путь к заметкам — от каталога запуска: дев поднимается из frontend/
    // (`npm run dev --workspace=@amplifie/frontend`), а копятся они там же,
    // где копились всегда.
    agentUiKit({ file: "../dock/замечания.md" }),
  ],
  // Тот же короткий путь, что в tsconfig: его ждёт CLI набора компонентов,
  // и без него скопированные исходники не соберутся.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    /**
     * ⚠️ ОДИН ЭКЗЕМПЛЯР REACT НА ВСЁ, И БЕЗ ЭТОГО ПРИЛОЖЕНИЕ ПРОСТО
     * НЕ ЗАПУСКАЕТСЯ. В рабочей области npm поднимает часть пакетов
     * в корневой `node_modules`, часть оставляет во фронтовой. Пакет,
     * поднятый в корень, находит СВОЙ React — и хуки ломаются с невнятным
     * «Cannot read properties of null (reading 'useContext')»: два React
     * не делят между собой внутреннее состояние.
     *
     * Поймано при переходе на значки Phosphor: экран падал целиком,
     * а сообщение об ошибке о причине не говорило ни слова.
     */
    dedupe: ["react", "react-dom"],
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
