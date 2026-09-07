import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Плагин даёт быстрое обновление при правке. Без него JSX собирается,
  // но каждая правка перезагружает страницу целиком.
  plugins: [react(), tailwind()],
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
    proxy: { "/v1": "http://localhost:8477", "/health": "http://localhost:8477" },
  },
});
