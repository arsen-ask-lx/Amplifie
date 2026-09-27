#!/usr/bin/env node
/**
 * Описание API (OpenAPI) из zod-схем дверей (task-120, Р-049).
 *
 * `npm run openapi` — пересобрать `backend/openapi.json`;
 * `npm run openapi:check` — сверить: разошлось с кодом — красный.
 *
 * ⚠️ ОПИСАНИЕ ПРОИЗВОДНОЕ, НЕ ВТОРОЙ ИСТОЧНИК. Его строят те же схемы, которыми
 * Fastify проверяет вход и режет выход. Править файл руками бессмысленно —
 * следующая сборка его перепишет, а сверка покраснеет.
 *
 * Сборка — из `backend/dist` (`tsc --build` в скрипте npm), как у `cost`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = "backend/openapi.json";
const checking = process.argv.includes("--check");

// ⚠️ БАЗА ОПИСАНИЮ НЕ НУЖНА, НО `config` ТРЕБУЕТ АДРЕС ПРИ ИМПОРТЕ. Пул pg
// соединяется на первом запросе, а сборка приложения запросов не шлёт —
// порт 1 гарантирует громкий отказ, если это когда-нибудь изменится.
// В конвейере быстрое задание идёт без базы, и без этой строки сверка падала бы.
process.env.DATABASE_URL ??= "postgres://openapi@127.0.0.1:1/none";
process.env.LOG_LEVEL ??= "silent";

const { buildApp } = await import("../../backend/dist/surface/http/app.js");
const app = await buildApp({ describeApi: true });
await app.ready();
const spec = app.swagger();
const text = `${JSON.stringify(spec, null, 2)}\n`;
const operations = Object.values(spec.paths ?? {}).reduce(
  (sum, item) => sum + Object.keys(item).length,
  0,
);

// Ссылка на дверь, которой нет, — отказ сборки, а не битое описание: по ней
// Schemathesis молча перестал бы проходить цепочку (backend/src/surface/http/links.ts).
const unpointer = (part) => part.replaceAll("~1", "/").replaceAll("~0", "~");
const broken = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(item)) {
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      for (const [name, link] of Object.entries(response.links ?? {})) {
        const [, , target, verb] = (link.operationRef ?? "").split("/");
        if (!target || !spec.paths[unpointer(target)]?.[verb]) {
          broken.push(`${method.toUpperCase()} ${path} ${status} → ${name}: ${link.operationRef}`);
        }
      }
    }
  }
}
if (broken.length > 0) {
  console.error("ссылки описания API ведут на двери, которых нет:");
  for (const line of broken) console.error(`  ${line}`);
  console.error("  почини: поправь linksTo(...) у двери, которая заводит ресурс");
  process.exit(1);
}

if (!checking) {
  writeFileSync(FILE, text);
  console.log(`описание API: ${FILE}, операций ${operations}`);
  process.exit(0);
}

const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : null;
if (current === null) {
  console.error(`описания API нет: ${FILE}`);
  console.error("  почини: npm run openapi — и закоммить файл");
  process.exit(1);
}
if (current !== text) {
  console.error(`описание API отстало от схем дверей: ${FILE}`);
  console.error("  почини: npm run openapi — и закоммить файл вместе с правкой схемы");
  process.exit(1);
}
console.log(`описание API свежее: операций ${operations}`);
// Таймеры приложения (метрики, шина) держали бы процесс: выходим явно.
process.exit(0);
