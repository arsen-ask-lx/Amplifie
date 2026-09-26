#!/usr/bin/env node
/**
 * Мост одним архивом — то, что `npx` скачивает с нашего сайта (task-065, Р-036).
 *
 * Строка `npm run bridge` работала только из папки проекта: мост собирался
 * из исходников на месте. Здесь он собирается один раз, в один файл —
 * из чужого у него только `@amplifie/model`, его и вшиваем, — и пакуется
 * в обычный npm-архив. Бек отдаёт архив, `npx` ставит его и запускает.
 *
 * Выход: `bridge/package/amplifie-bridge.tgz`. Запуск: `npm run bridge:pack`.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const OUT = "bridge/package";
const NAME = "amplifie-bridge";
const VERSION = "1.0.0";

/**
 * ⚠️ ИЩЕМ TSC ОТ КОРНЯ ПАКЕТА, А НЕ ПО ПРЯМОМУ ПУТИ `typescript/bin/tsc`.
 *
 * TypeScript 7 убрал `./bin/tsc` из списка `exports`, и прямое обращение
 * падает с `ERR_PACKAGE_PATH_NOT_EXPORTED`. Сам файл на диске остался —
 * это по-прежнему двухстрочная обёртка на Node. `./package.json` пакет
 * отдаёт всегда, поэтому от него и считаем.
 *
 * Поймано сборкой образа 26.09, а не проверкой типов: тот, кто зовёт
 * упаковку моста, — только Dockerfile.
 */
const tsc = join(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin",
  "tsc",
);
execFileSync(process.execPath, [tsc, "--build", "bridge"], { stdio: "inherit" });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ["bridge/dist/main.js"],
  outfile: join(OUT, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Не наш Node 26, а тот, что стоит у человека: `fetch` есть с двадцатого.
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});

writeFileSync(
  join(OUT, "package.json"),
  `${JSON.stringify(
    {
      name: NAME,
      version: VERSION,
      type: "module",
      bin: { [NAME]: "main.mjs" },
      engines: { node: ">=20" },
    },
    null,
    2,
  )}\n`,
);

// Через оболочку: `npm` на Windows — это `npm.cmd`, напрямую его не запустить.
execSync("npm pack --silent --pack-destination .", {
  cwd: OUT,
  stdio: ["ignore", "ignore", "inherit"],
});
renameSync(join(OUT, `${NAME}-${VERSION}.tgz`), join(OUT, `${NAME}.tgz`));
console.log(`мост упакован: ${OUT}/${NAME}.tgz`);
