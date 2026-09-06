#!/usr/bin/env node
/**
 * Вторая разметка корпуса К2 — вручную, человеком.
 *
 * ЗАЧЕМ. Согласие людей о том, что считать договорённостью, — умеренное
 * (каппа 0.36–0.47 в исследованиях). Без второй независимой разметки любое
 * число агента означает лишь «совпал с одним человеком» (Р-004).
 *
 * ЧТО ЗДЕСЬ СКРЫТО И ПОЧЕМУ. На экран не выводятся ни первая разметка, ни
 * пояснение к ней, ни класс трудности. Разметчик, увидевший чужой ответ,
 * уже не размечает — он соглашается, и согласие получается завышенным.
 *
 * СОХРАНЯЕТСЯ ПОСЛЕ КАЖДОГО ОТВЕТА. Прерывание на середине не теряет работу:
 * повторный запуск продолжает с неразмеченного.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { AGREEMENT, CHATTER } from "./kappa.mjs";

const CORPUS = "arbiter/corpus.jsonl";
const OUT = "arbiter/labels-b.json";

// Обе раскладки: переключать её ради одной буквы — верный способ
// получить случайный ответ вместо обдуманного.
const YES = ["д", "d"];
const NO = ["н", "n"];
const SKIP = ["п", "p"];
const QUIT = ["в", "v"];

const ANSWERS = new Map([
  ...YES.map((k) => [k, AGREEMENT]),
  ...NO.map((k) => [k, CHATTER]),
  ...SKIP.map((k) => [k, null]),
]);

const VOPROS = `
  Договорённость ли это?

    д  — да, кто-то взял на себя обязательство
    н  — нет, это разговор без обязательства
    п  — пропустить, решу позже
    в  — выйти (сохранено всё, что уже отвечено)
`;

function loadCorpus() {
  return readFileSync(CORPUS, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function loadDone() {
  return existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
}

/** Реплика на экран — БЕЗ первой разметки, пояснения и класса трудности. */
function show(item, position, total) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${item.id}   ${position} из ${total}`);
  console.log(`${"─".repeat(60)}`);
  for (const line of item.context) console.log(`    …  ${line}`);
  console.log(`\n    ➜  ${item.utterance || "«молчание»"}`);
}

const corpus = loadCorpus();
const done = loadDone();
const todo = corpus.filter((item) => !(item.id in done));

if (todo.length === 0) {
  console.log(`всё размечено: ${Object.keys(done).length} из ${corpus.length}`);
  console.log("отчёт: make arbiter");
  process.exit(0);
}

console.log(`\nВторая разметка корпуса К2.`);
console.log(`осталось: ${todo.length} из ${corpus.length}`);
console.log(VOPROS);

// Инструмент для человека за терминалом. Если ввод не терминал (труба,
// конвейер), readline ждёт ответа, которого не будет, и процесс подвисает
// молча. Отказ с объяснением честнее зависания.
if (!stdin.isTTY) {
  console.error("make label — для человека за терминалом: нужен настоящий ввод.");
  console.error("В Claude Code запусти сам, строкой:  !node arbiter/label.mjs");
  process.exit(2);
}

const rl = createInterface({ input: stdin, output: stdout });

// Ctrl+D и Ctrl+C закрывают ввод. Без этого обработчика следующий вопрос
// повис бы навсегда, а уже размеченное осталось бы без итоговой строки.
let closed = false;
rl.once("close", () => {
  closed = true;
});

for (const [index, item] of todo.entries()) {
  if (closed) break;
  show(item, index + 1, todo.length);
  const raw = (await rl.question("\n  д / н / п / в  ›  ")).trim().toLowerCase();

  if (QUIT.includes(raw)) break;
  if (!ANSWERS.has(raw)) {
    console.log("  не понял ответа — реплика пропущена, вернёмся к ней при следующем запуске");
    continue;
  }
  const label = ANSWERS.get(raw);
  if (label === null) continue;

  done[item.id] = label;
  // Записываем сразу: прерывание на середине не должно стоить работы.
  writeFileSync(OUT, `${JSON.stringify(done, null, 2)}\n`, "utf8");
}

rl.close();
console.log(`\nразмечено: ${Object.keys(done).length} из ${corpus.length} → ${OUT}`);
console.log("отчёт: make arbiter");
