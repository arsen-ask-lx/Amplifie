#!/usr/bin/env node
/**
 * Повторы в прод-коде под храповиком.
 *
 * ЗАЧЕМ ХРАПОВИК, А НЕ ПРОСТО ГЕЙТ. Запись каталога `duplicate-code` при
 * установке сразу нашла 18 повторов на накопленном коде. Ввести её как есть
 * значит покрасить сборку навсегда; выключить — значит завести правило,
 * за которым никто не следит. Храповик — третий ответ: известное число
 * записано, оно может ТОЛЬКО уменьшаться, любой новый повтор красит.
 *
 * ПОЧЕМУ ТЕСТЫ НЕ СЧИТАЮТСЯ. Из 18 повторов 13 — в приёмочных тестах: там
 * повторяется подготовка (зарегистрировать, войти, создать пространство).
 * Вынести её в общий помощник значит связать тесты друг с другом и сделать
 * упавший тест нечитаемым — его придётся читать через два файла. Это давно
 * названная развилка: тесты пишутся понятными, а не сухими (DAMP, не DRY).
 * Решение записано в dock/decisions/015.
 *
 * ⚠️ Уменьшил число повторов — уменьши и число в реестре. Иначе храповик
 * молча разрешит вернуть повтор обратно.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Только прод-код. Тесты — см. шапку. */
const SCOPE = ["backend/src", "frontend/src", "bridge/src", "packages/model/src"];

const RATCHET = "tools/ratchets/duplicate-code.txt";

/** Повтор короче этого — совпадение, а не копия. */
const MIN_LINES = 8;

const out = join(tmpdir(), "amplifie-jscpd");
const command =
  `npx --yes jscpd@5 --min-lines ${MIN_LINES} --threshold 100 ` +
  `--format "typescript,tsx" --reporters json --output "${out}" --silent ${SCOPE.join(" ")}`;

const run = spawnSync(command, { shell: true, encoding: "utf8" });
const report = join(out, "jscpd-report.json");

if (!existsSync(report)) {
  console.error("повторы: jscpd не оставил отчёта — проверка не состоялась");
  console.error(`${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  process.exit(1);
}

const found = JSON.parse(readFileSync(report, "utf8")).duplicates ?? [];

const allowed = existsSync(RATCHET)
  ? Number((/^\s*(\d+)\s*$/mu.exec(readFileSync(RATCHET, "utf8")) ?? [])[1] ?? 0)
  : 0;

const short = (name) => name.split(/[\\/]/u).slice(-3).join("/");

if (found.length > allowed) {
  console.error(`\nПовторов в прод-коде: ${found.length}, в реестре разрешено ${allowed}\n`);
  for (const one of found) {
    console.error(
      `  ${short(one.firstFile.name)} ↔ ${short(one.secondFile.name)} — ${one.lines} строк`,
    );
  }
  console.error(
    "\n  ПОЧИНИТЬ: вынеси общее в одно место. Не поднимай число в реестре —\n" +
      "  храповик крутится в одну сторону, иначе он не храповик, а комментарий.",
  );
  process.exit(1);
}

if (found.length < allowed) {
  console.error(`\nПовторов стало меньше: ${found.length} против ${allowed} в реестре.\n`);
  console.error(`  ПОЧИНИТЬ: запиши новое число в ${RATCHET}.`);
  console.error("  Иначе храповик разрешит вернуть повтор обратно, и работа пропадёт.");
  process.exit(1);
}

console.log(`повторы: ${found.length} — столько же, сколько в реестре, роста нет — OK`);
