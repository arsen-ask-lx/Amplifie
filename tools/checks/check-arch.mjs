#!/usr/bin/env node
/**
 * Границы модулей — с проверкой, что обход вообще состоялся.
 *
 * ЗАЧЕМ ОБЁРТКА. 2026-09-07, подъём до TypeScript 7.0: dependency-cruiser
 * не поддерживает седьмую версию (её compiler API появится в 7.1), обошёл
 * НОЛЬ модулей и напечатал «no dependency violations found» с кодом 0.
 * Подсаженное нарушение `kernel` → `surface` он при этом не увидел.
 *
 * То есть сторож ослеп и отрапортовал «всё чисто». Это опаснее падения:
 * падение чинят, а зелёный никто не проверяет.
 *
 * ЧТО ЗДЕСЬ ДОБАВЛЕНО К САМОМУ ИНСТРУМЕНТУ:
 *   ① обошёл меньше порога модулей — падение, даже если нарушений нет;
 *   ② инструмент сам жалуется, что мог что-то пропустить, — падение.
 *
 * Порог намеренно грубый и низкий: он ловит обвал до нуля, а не колебания
 * в пару файлов. Сторож, который краснеет на каждом удалённом файле,
 * выключают через неделю.
 */
import { spawnSync } from "node:child_process";

const CONFIG = "tools/dependency-cruiser.cjs";
const SCOPE = ["backend", "bridge"];

/**
 * Меньше этого числа модулей — значит, обход не состоялся.
 * На 2026-09-07 их 65. Порог держим много ниже, чтобы он говорил
 * «обвал», а не «файлов стало меньше».
 */
const FLOOR = 20;

/** Инструмент сам признаётся, что мог пропустить исходники. */
const BLIND = /missing-typescript-transpiler|likely to have missed/iu;

// Одной строкой, а не массивом: с `shell: true` Node предупреждает, что
// аргументы не экранируются. Строка здесь наша целиком, из констант выше —
// пользовательского ввода в ней нет.
const command = `npx depcruise ${SCOPE.join(" ")} --config ${CONFIG} --output-type err-long`;
const run = spawnSync(command, { shell: true, encoding: "utf8" });

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
process.stdout.write(output);

if (run.status !== 0) process.exit(run.status ?? 1);

if (BLIND.test(output)) {
  console.error(
    "\nГраницы модулей: инструмент сообщил, что мог пропустить исходники.\n" +
      "  ПОЧИНИТЬ: это не предупреждение, а слепой сторож. Чаще всего —\n" +
      "  несовместимая версия TypeScript (см. dock/decisions/015).\n" +
      "  Зелёный отчёт от ослепшего арбитра хуже, чем его отсутствие.",
  );
  process.exit(1);
}

const counted = /(\d+)\s+modules/u.exec(output);
const modules = counted ? Number(counted[1]) : 0;

if (modules < FLOOR) {
  console.error(
    `\nГраницы модулей: обойдено ${modules} модулей, ожидалось не меньше ${FLOOR}.\n` +
      "  ПОЧИНИТЬ: обход не состоялся — проверь пути в package.json и версию\n" +
      "  TypeScript. «Нарушений не найдено» при нуле модулей означает не\n" +
      "  чистоту, а то, что смотреть было не на что.",
  );
  process.exit(1);
}

console.log(`границы модулей: обойдено ${modules} модулей — OK`);
