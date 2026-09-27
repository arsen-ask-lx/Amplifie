/**
 * В замке версий есть двоичные файлы для Linux — иначе образ не соберётся.
 *
 * ⚠️ ЭТО НЕ ПРИДИРКА, А ЦЕНА ТРЁХ ПРОГОНОВ. У npm известная ошибка
 * (npm/cli#8320): платформенные необязательные зависимости попадают в замок
 * только для той платформы, где он собран. Пересобранный на Windows замок
 * выглядит совершенно здоровым — и валит сборку образа на
 * `Cannot find module '../rolldown-binding.linux-x64-gnu.node'`,
 * то есть через восемь минут, а не через восемь секунд.
 *
 * Ставят замок в двух местах, и оба линуксовые: образы и конвейер.
 * Проверка смотрит ровно то, чего им не хватает.
 */
import { existsSync, readFileSync } from "node:fs";

const FILE = "package-lock.json";

/**
 * Что обязано быть. Список не «все возможные», а «те, без которых падает
 * СБОРКА ОБРАЗА»: сборщик фронта, движок Tailwind и esbuild.
 */
const NEEDED = [
  "node_modules/@rolldown/binding-linux-x64-gnu",
  "node_modules/@tailwindcss/oxide-linux-x64-gnu",
  "node_modules/@esbuild/linux-x64",
];

if (!existsSync(FILE)) {
  console.error(`${FILE}: замка нет; пустота успехом не является`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(FILE, "utf8"));
const packages = lock.packages ?? {};

const missing = NEEDED.filter((name) => !packages[name]);

/**
 * ⚠️ ПРИЗРАКИ ТОЖЕ ЗДЕСЬ, И ПО ТОЙ ЖЕ ПРИЧИНЕ. 26.09 в замке нашлись записи
 * `apps/api`, `apps/bridge`, `apps/web` — рабочие области прошлого устройства
 * проекта, папок которых давно нет. Они держали старые версии (fastify 5.12.3,
 * zod 4.5.4), из-за чего в дереве жило по две копии одного пакета, а сборка
 * бека падала двадцатью ошибками «request.params неизвестного типа».
 * Запись без своей папки — мусор, который тихо правит разрешение версий.
 */
const declared = new Set(
  (Array.isArray(lock.packages?.[""]?.workspaces) ? lock.packages[""].workspaces : []).flatMap(
    (pattern) => (pattern.endsWith("/*") ? [pattern.slice(0, -2)] : [pattern]),
  ),
);
const ghosts = Object.keys(packages).filter((name) => {
  if (name === "" || name.includes("node_modules")) return false;
  const root = name.split("/")[0];
  return !declared.has(root) && !declared.has(name);
});

const problems = [
  ...missing.map((name) => `нет двоичного файла для Linux: ${name}`),
  ...ghosts.map((name) => `призрачная рабочая область без своей папки: ${name}`),
];

if (problems.length > 0) {
  console.error(`${FILE}: замок не годен для сборки образа`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  console.error("  ПОЧИНИТЬ: пересобрать замок в Linux — `make deps-lock`.");
  console.error("  НЕ `rm package-lock.json && npm install` на Windows: это и ломает.");
  console.error("  Почему так — npm/cli#8320, разбор в Makefile у цели deps-lock.");
  process.exit(1);
}

const linux = Object.keys(packages).filter((name) => name.includes("linux")).length;
console.log(`замок версий: двоичных для Linux ${linux}, призраков нет — OK`);
