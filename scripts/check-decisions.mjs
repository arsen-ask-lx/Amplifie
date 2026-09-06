#!/usr/bin/env node
/**
 * Гейт: решение без внешних источников не проходит сборку.
 *
 * ЗАЧЕМ. Там, где цена ошибки высока, обязателен веб-ресёрч: почти всякую
 * ошибку кто-то уже совершил и описал. Правило «надо поискать» — мягкое,
 * и агент обойдёт его при первом неудобстве. Поэтому оно переведено
 * в жёсткое: у каждого документа в dock/decisions/ обязан быть раздел
 * с источниками и хотя бы две внешние ссылки.
 *
 * Две, а не одна: одна ссылка — это «нашёл подтверждение своей мысли»,
 * две разные — уже сверка. Чужой опыт ценен именно расхождениями.
 *
 * Сообщение об ошибке несёт инструкцию по починке — так линтер работает
 * и на человека, и на агента.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "dock/decisions";
const MIN_SOURCES = 2;
const SECTION = /^#{1,3}\s*(источник|source)/imu;
const EXTERNAL_LINK = /\]\(https?:\/\/[^)]+\)/gu;

/** Ссылки на самих себя источником не считаются. */
const SELF_HOSTS = [/^https?:\/\/localhost/iu, /^https?:\/\/127\./u];

function externalLinks(text) {
  return [...text.matchAll(EXTERNAL_LINK)]
    .map((m) => m[0].slice(2, -1))
    .filter((url) => !SELF_HOSTS.some((self) => self.test(url)));
}

let files;
try {
  files = readdirSync(DIR).filter((name) => name.endsWith(".md"));
} catch {
  console.log(`${DIR}/ пока нет — проверять нечего`);
  process.exit(0);
}

const problems = [];

// Два решения под одним номером. Случилось на самом деле: владелец и агент
// писали параллельно и оба взяли 005. Ссылка «см. Р-005» после этого
// указывает на два разных документа, и читающий не знает, на какой.
const byNumber = new Map();
for (const name of files) {
  const number = /^(\d+)/u.exec(name)?.[1];
  if (!number) continue;
  byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
}
for (const [number, names] of byNumber) {
  if (names.length < 2) continue;
  problems.push(
    `${DIR}/ — номер ${number} занят дважды: ${names.join(", ")}
` +
      `  ПОЧИНИТЬ: перенумеруй то решение, на которое ещё никто не ссылается,
` +
      `  и поправь ссылки на него в коде и документах. Ссылка «см. Р-${number}»
` +
      `  при двух документах указывает в никуда.`,
  );
}

for (const name of files) {
  const path = join(DIR, name);
  const text = readFileSync(path, "utf8");

  if (!SECTION.test(text)) {
    problems.push(
      `${path}\n` +
        `  нет раздела с источниками.\n` +
        `  ПОЧИНИТЬ: добавь в конец «## Источники» и перечисли, что читал.\n` +
        `  Если не читал — значит решение принято на память, а не на проверку:\n` +
        `  сделай веб-ресёрч ДО того, как это станет накопленными данными.`,
    );
    continue;
  }

  const links = externalLinks(text);
  if (links.length < MIN_SOURCES) {
    problems.push(
      `${path}\n` +
        `  внешних ссылок: ${links.length}, нужно минимум ${MIN_SOURCES}.\n` +
        `  ПОЧИНИТЬ: одна ссылка — это «нашёл подтверждение своей мысли».\n` +
        `  Нужны хотя бы два независимых источника: официальная документация\n` +
        `  и чужой разбор, где описаны грабли. Расхождения между ними —\n` +
        `  самое ценное, что даёт ресёрч.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\nРешения без источников: ${problems.length} из ${files.length}\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  console.error(
    "Правило: где цена ошибки высока — сначала веб-ресёрч, потом решение.\n" +
      "См. dock/decisions/README.md\n",
  );
  process.exit(1);
}

console.log(`решения: ${files.length}, у всех есть источники — OK`);
