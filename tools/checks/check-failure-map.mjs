#!/usr/bin/env node
/**
 * Гейт: код отказа разбирается в ОДНОМ месте (task-012, находка ①).
 *
 * ЗАЧЕМ. На 2026-09-07 карта «код HTTP → что сказать человеку» жила
 * в четырёх файлах фронта: useChat.ts, Board.tsx, ModelScreen.tsx,
 * KeyPanel.tsx. И уже разъехалась: 503 в одном месте — «не подключена
 * ни одна нейросеть», в другом — «мост не на связи».
 *
 * ПОЧЕМУ ЭТОГО НЕ ЛОВИТ `duplicate-code`. Тот гейт — jscpd с порогом
 * в восемь одинаковых строк: он ищет копипасту ТЕКСТА. Здесь же одно
 * знание записано четырьмя разными способами — где switch, где цепочка
 * if, где свои слова. Для jscpd это четыре разных файла, и он прав
 * по-своему. DRY — про знание, а не про похожие строки, и мерить его
 * похожестью строк нельзя.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Во фронте разбор кода ответа (`error.status`,
 * `ApiError`, голое число кода) допустим только в слое `shared/`.
 * Экран, которому нужны свои слова, берёт ПРИЧИНУ и пишет их сам —
 * но код HTTP не разбирает.
 *
 * ⚠️ ПОЧЕМУ РАЗРЕШЁН ВЕСЬ `shared/`, А НЕ ОДИН ФАЙЛ. Сам этот гейт при
 * первом прогоне нашёл пятую копию — `authMessages.ts` — и вместе с ней
 * показал, что общего словаря кодов быть НЕ МОЖЕТ: 409 при входе значит
 * «почта занята», а на доске — «размыкатель разомкнут». Один код, два
 * разных знания. Общее здесь — не таблица, а СНЯТИЕ кода с ошибки; таблиц
 * же законно несколько, по одной на область. Поэтому граница проведена
 * по слою: разбор живёт в `shared/`, а не расползается по экранам.
 *
 * ЧТО НЕ ПРОВЕРЯЕТСЯ. Бек: там код ответа — это и есть предмет работы
 * ручки, а не знание, растёкшееся по экранам.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "frontend/src";

/** Слой, где законно знать про коды. Почему слой, а не файл — см. шапку. */
const HOME = "shared/";

/**
 * Слой сети: он ОБЯЗАН читать код ответа, чтобы завернуть его в ApiError.
 * Это не разбор «что сказать человеку», а разбор «удался ли запрос».
 */
const NETWORK = "data/api";

const SIGNS = [
  {
    pattern: /\b(?:error|failure|err)\s*\.\s*status\b/u,
    why: "разбор кода ответа вне общего места",
  },
  {
    pattern: /\bApiError\s*&&|instanceof\s+ApiError/u,
    why: "разбор вида ошибки сети вне общего места",
  },
  {
    // Голое число кода рядом со сравнением: `=== 503`, `case 504:`.
    pattern: /(?:===|==|case)\s*(?:40[0-9]|41[0-9]|42[2-9]|50[0-9])\b/u,
    why: "код HTTP числом вне общего места",
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

/** Свой путь в общем виде: и `shared/failure.ts`, и `shared\failure.ts`. */
const inside = (path, where) => path.split(/[\\/]/u).join("/").includes(where);

const problems = [];
let scanned = 0;

for (const path of filesUnder(ROOT)) {
  if (inside(path, HOME) || inside(path, NETWORK)) continue;
  scanned++;

  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const code = line.trim();
    // Объяснения не ловим — только код.
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;

    for (const sign of SIGNS) {
      if (!sign.pattern.test(line)) continue;
      problems.push(
        `${path}:${index + 1} — ${sign.why}\n` +
          `  ${code.slice(0, 90)}\n` +
          `  ПОЧИНИТЬ: возьми причину из ${HOME}failure.ts (reasonOf), а слова напиши свои.\n` +
          "  Код HTTP разбирается один раз: иначе смена кода на сервере\n" +
          "  чинится в одном месте из четырёх, а три молча врут дальше.",
      );
      break;
    }
  }
}

if (problems.length > 0) {
  console.error(`\nКод отказа разбирается не в одном месте: ${problems.length}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  console.error(`Разбор кода живёт в слое ${ROOT}/${HOME} (task-012, находка ①).\n`);
  process.exit(1);
}

// Числа важнее вердикта (Р-015): гейт, которому нечего смотреть, тоже зелёный.
if (scanned === 0) {
  console.error(`\nкарта отказов: просмотрено 0 файлов в ${ROOT} — проверка не состоялась\n`);
  process.exit(1);
}

console.log(`карта отказов в одном месте: просмотрено файлов ${scanned} — OK`);
