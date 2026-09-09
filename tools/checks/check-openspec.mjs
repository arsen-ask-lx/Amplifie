#!/usr/bin/env node
/**
 * Гейт: спецификация поведения не расходится с тем, что сделано.
 *
 * ЗАЧЕМ. OpenSpec держит единственную истину о наблюдаемом поведении
 * в `openspec/specs/`, а `changes/` — это работа в полёте, которая
 * обязана влиться туда и уйти в архив. Цикл `предложить → сделать →
 * синхронизировать → заархивировать` замкнут ровно до тех пор, пока
 * кто-то его замыкает.
 *
 * У нас он один раз оборвался на третьем шаге: изменение сделано,
 * дельта написана, `specs/` пуст. То есть мы написали разницу
 * к спецификации, которой не существует, и целые сутки не знали об этом.
 * Отсюда этот сторож.
 *
 * ⚠️ БЕЗ CLI OPENSPEC, ТОЛЬКО ФАЙЛЫ. Инструмент стоит глобально, и его
 * нет в конвейере: гейт, зависящий от чужой глобальной установки,
 * краснеет там, где код исправен. Здесь читается только дерево.
 *
 * ⚠️ ПОРОГ — НЕ «СТАРШЕ N ДНЕЙ». Произвольное число пришлось бы защищать,
 * и его бы обошли. Признак точный: все задачи отмечены сделанными,
 * а изменение всё ещё лежит в работе. Пока хоть одна не закрыта — работа
 * идёт, и торопить её незачем.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "openspec";
const CHANGES = join(ROOT, "changes");
const ARCHIVE = join(CHANGES, "archive");
const SPECS = join(ROOT, "specs");

function dirsIn(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory());
}

/** Все `spec.md` в дереве, на любой глубине: способности бывают вложенными. */
function specsIn(path) {
  if (!existsSync(path)) return [];
  const found = [];
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) found.push(...specsIn(full));
    else if (name === "spec.md") found.push(full);
  }
  return found;
}

/** Отметки задач изменения. Нет файла — считать нечего, и это не отказ. */
function tasksOf(change) {
  const path = join(CHANGES, change, "tasks.md");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return {
    done: (text.match(/^\s*-\s*\[x\]/gimu) ?? []).length,
    left: (text.match(/^\s*-\s*\[ \]/gmu) ?? []).length,
  };
}

if (!existsSync(ROOT)) {
  console.log(`openspec: каталога ${ROOT}/ нет — проверять нечего`);
  process.exit(0);
}

const active = dirsIn(CHANGES).filter((name) => name !== "archive");
const archived = dirsIn(ARCHIVE);
const specs = specsIn(SPECS);
const problems = [];

// ① Сделано, но не заархивировано. Незакрытое изменение — вторая правда
//    о поведении рядом с главной спекой.
for (const change of active) {
  const tasks = tasksOf(change);
  if (!tasks || tasks.done === 0 || tasks.left > 0) continue;
  problems.push(
    `${join(CHANGES, change)} — все ${tasks.done} задач отмечены, а изменение всё ещё в работе.\n` +
      "  ПОЧИНИТЬ: синхронизируй дельту в openspec/specs/ и заархивируй —\n" +
      `  ${join(ARCHIVE, "ГГГГ-ММ-ДД-имя")}. Пока изменение висит, о поведении\n` +
      "  говорят два документа сразу, и они расходятся молча.",
  );
}

// ② Дельта была, а спеки нет. Ровно наша ошибка: разница написана
//    к тому, чего не существует.
if (archived.length > 0 && specs.length === 0) {
  problems.push(
    `${SPECS}/ пуст, хотя в архиве изменений: ${archived.length}.\n` +
      "  ПОЧИНИТЬ: дельта обязана влиться в главную спеку ДО архивации.\n" +
      "  Спецификация, которой нет, не может быть источником истины —\n" +
      "  а именно за этим OpenSpec и заведён.",
  );
}

if (problems.length > 0) {
  console.error(`\nOpenSpec: цикл не замкнут — ${problems.length}\n`);
  for (const one of problems) console.error(`${one}\n`);
  process.exit(1);
}

// Числа важнее вердикта (Р-015): зелёный на пустом дереве обязан быть
// виден как зелёный на пустом дереве.
console.log(
  `openspec: в работе ${active.length}, в архиве ${archived.length}, ` +
    `спецификаций ${specs.length} — OK`,
);
