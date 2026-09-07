#!/usr/bin/env node
/**
 * Гейт: список стадий задачи объявлен один раз (task-012, находка ②).
 *
 * ЗАЧЕМ. На 2026-09-07 список стадий жил в трёх местах:
 *   • CHECK `task_stage_known` в миграции 0008 — настоящий сторож;
 *   • `STAGES` в backend/src/kernel/work/service.ts;
 *   • `COLUMNS` в frontend/src/Board.tsx.
 *
 * ⚠️ ПЕРЕНОС В ОБЩИЙ ПАКЕТ САМ ПО СЕБЕ НЕ ЧИНИТ. Код можно свести
 * к одному объявлению, но SQL останется отдельной копией: миграция —
 * это текст, а не импорт. Без сверки мы бы переставили копию и решили,
 * что убрали её. Поэтому гейт читает ОБЕ стороны: объявление в пакете
 * и CHECK в миграциях.
 *
 * ЧЕГО ГЕЙТ НЕ УМЕЕТ, СКАЗАНО ВСЛУХ. Размыкатель (`BREAKER = 2`) тоже
 * переезжает в общий пакет, но у него нет второй стороны в SQL, и сверить
 * его не с чем. Его единственность держит только то, что он экспортируется
 * одним объявлением. Это слабее — и записано здесь, а не выдано за
 * проверенное.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Где живёт объявление. Единственный источник для кода. */
const CONTRACT = "packages/contract/src/work.ts";

/** Где живёт настоящий сторож. */
const MIGRATIONS = "backend/migrations";
const CONSTRAINT = "task_stage_known";

/** Стадии — строки в кавычках внутри объявления `STAGES`. */
const DECLARED = /export\s+const\s+STAGES\s*=\s*\[([^\]]+)\]/u;
const QUOTED = /["'`]([^"'`]+)["'`]/gu;

/** `... CHECK ( "status" IN ('a', 'b') )` — берём содержимое скобок IN. */
const IN_LIST = new RegExp(`${CONSTRAINT}[\\s\\S]*?IN\\s*\\(([^)]*)\\)`, "u");

function fail(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

if (!existsSync(CONTRACT)) {
  fail([
    `Стадии: нет общего объявления — ${CONTRACT}`,
    "  ПОЧИНИТЬ: заведи packages/contract и вынеси STAGES туда.",
    "  Сейчас список живёт в трёх местах: CHECK в миграции, STAGES на беке,",
    "  COLUMNS во фронте. Три копии расходятся молча (task-012, находка ②).",
  ]);
}

/**
 * Объяснения — не код.
 *
 * Первая редакция гейта нашла образец `export const STAGES = [ ... ]`
 * в шапке самого объявления и разобрала из него ноль стадий. Ошибка
 * поучительная: искать в тексте вместе с комментариями — значит верить
 * рассказу о коде, а не коду.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

const declaredBody = DECLARED.exec(withoutComments(readFileSync(CONTRACT, "utf8")))?.[1];
if (!declaredBody) {
  fail([
    `Стадии: в ${CONTRACT} не нашлось объявления вида`,
    "  export const STAGES = [ ... ]",
    "  ПОЧИНИТЬ: объяви список именно так — гейт читает его текстом,",
    "  потому что вторая сторона (SQL) тоже текст и импортом не берётся.",
  ]);
}
const declared = [...declaredBody.matchAll(QUOTED)].map((m) => m[1]);

// Берём ПОСЛЕДНЮЮ миграцию, где встречается ограничение: оно могло
// переопределяться, и действует то, что применилось позже.
const sql = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(MIGRATIONS, name), "utf8") }))
  .filter((file) => file.text.includes(CONSTRAINT))
  .at(-1);

if (!sql) {
  fail([
    `Стадии: в ${MIGRATIONS}/ нет ограничения ${CONSTRAINT}`,
    "  ПОЧИНИТЬ: настоящий сторож списка — CHECK в базе. Если его нет,",
    "  список не защищён ничем, кроме внимательности.",
  ]);
}

const inList = IN_LIST.exec(sql.text)?.[1];
if (!inList) {
  fail([
    `Стадии: в ${sql.name} нашлось ${CONSTRAINT}, но не разобрался список IN (…)`,
    "  ПОЧИНИТЬ: гейт обязан падать, а не молчать: неразобранный CHECK",
    "  неотличим от совпадающего (Р-015 — числа важнее вердикта).",
  ]);
}
const inDatabase = [...inList.matchAll(QUOTED)].map((m) => m[1]);

const only = (a, b) => a.filter((one) => !b.includes(one));
const missingInDb = only(declared, inDatabase);
const missingInCode = only(inDatabase, declared);

if (missingInDb.length > 0 || missingInCode.length > 0) {
  fail(
    [
      "Список стадий разошёлся с базой.",
      `  объявлено в ${CONTRACT}: ${declared.join(" · ")}`,
      `  в CHECK ${sql.name}:        ${inDatabase.join(" · ")}`,
      missingInDb.length > 0 ? `  ЕСТЬ В КОДЕ, НЕТ В БАЗЕ: ${missingInDb.join(" · ")}` : "",
      missingInCode.length > 0 ? `  ЕСТЬ В БАЗЕ, НЕТ В КОДЕ: ${missingInCode.join(" · ")}` : "",
      "  ПОЧИНИТЬ: новая стадия заводится миграцией И объявлением сразу.",
      "  Стадия, которой нет в базе, обрушит вставку; стадия, которой нет",
      "  в коде, просто не покажется на доске — и это хуже, потому что тихо.",
    ].filter(Boolean),
  );
}

console.log(`стадии: ${declared.length} — объявление и CHECK ${sql.name} совпадают — OK`);
