#!/usr/bin/env node
/**
 * Гейт: сырой HTML в интерфейс не вставляется (Р-002).
 *
 * ЗАЧЕМ. Решение о хранении текста заканчивается строкой «гейт: запрет
 * dangerouslySetInnerHTML в коде фронта». Долг закрыт.
 *
 * Разметка отрисовывается узлами React, поэтому нужды в этом свойстве
 * нет вовсе. Запрет держит не аккуратность, а отсутствие пути: пока
 * его нет в коде, целого класса дыр не существует.
 *
 * Заодно ловим прямую запись в innerHTML и outerHTML — тот же класс,
 * только мимо React.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web/src";

const FORBIDDEN = [
  {
    pattern: /dangerouslySetInnerHTML/u,
    why: "вставка сырого HTML в React",
    fix: "отрисуй узлами React — см. apps/web/src/RichText.tsx",
  },
  {
    pattern: /\.(inner|outer)HTML\s*=/u,
    why: "прямая запись HTML в DOM мимо React",
    fix: "собери узлы, а не строку разметки",
  },
];

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/u.test(name)) found.push(path);
  }
  return found;
}

const problems = [];
let scanned = 0;

for (const path of filesUnder(ROOT)) {
  scanned++;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    // Строка гейта в комментарии сама себя не ловит: ищем в коде,
    // а не в объяснениях. Простейший признак — строка не комментарий.
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;

    for (const rule of FORBIDDEN) {
      if (!rule.pattern.test(line)) continue;
      problems.push(
        `${path}:${index + 1} — ${rule.why}\n` +
          `  ${code.slice(0, 90)}\n` +
          `  ПОЧИНИТЬ: ${rule.fix}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\nСырой HTML в интерфейсе: ${problems.length}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  console.error("Правило: текст показывается узлами, а не строкой разметки (Р-002).\n");
  process.exit(1);
}

console.log(`сырого HTML нет: просмотрено файлов ${scanned} — OK`);
