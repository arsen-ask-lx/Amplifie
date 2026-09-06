#!/usr/bin/env node
/**
 * Выпуск листа для второй разметки корпуса К2.
 *
 * Создаёт (или обновляет) `arbiter/labels-b.txt` — обычный текстовый файл,
 * который правят в редакторе. Уже данные ответы сохраняются, поэтому команду
 * можно звать сколько угодно: она не стирает работу.
 *
 * Диалога в терминале здесь намеренно нет: он не запускается там, где
 * владелец работает на самом деле (см. журнал шишек за 2026-09-06).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { parseSheet, renderSheet } from "./sheet.mjs";

const CORPUS = "arbiter/corpus.jsonl";
const SHEET = "arbiter/labels-b.txt";

const corpus = readFileSync(CORPUS, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const existing = existsSync(SHEET) ? parseSheet(readFileSync(SHEET, "utf8")).answers : {};
writeFileSync(SHEET, renderSheet(corpus, existing), "utf8");

const done = Object.keys(existing).length;
console.log(`\nЛист разметки: ${SHEET}`);
console.log(`реплик: ${corpus.length}, уже отвечено: ${done}, осталось: ${corpus.length - done}`);
console.log("\nОткрой файл, замени ? на д или н, сохрани. Потом: make arbiter");
console.log("Незаполненное просто не считается — можно в несколько заходов.\n");
