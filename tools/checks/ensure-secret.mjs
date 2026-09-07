#!/usr/bin/env node
/**
 * Мастер-ключ шифрования в .env — свой у каждой установки (Р-016).
 *
 * ПОЧЕМУ НЕ В .env.example. Готовое значение в образце означало бы, что
 * у всех установок один и тот же мастер-ключ, — то есть что его нет.
 * Здесь он рождается при первом `make env` и больше не трогается.
 *
 * ПОЧЕМУ ОТДЕЛЬНОЙ ПРОГРАММОЙ, А НЕ СТРОКОЙ В MAKEFILE. Многострочный
 * рецепт с нашим префиксом «>» не склеивается переносами: первая же
 * попытка развалилась на «sed -i.bak: command not found». Разработка
 * идёт на Windows, и `sed -i` там ведёт себя иначе, чем в Linux.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = ".env";
const NAME = "AMPLIFIE_SECRET_KEY";

if (!existsSync(FILE)) {
  console.error(`${FILE} не найден — сперва создайте его из .env.example`);
  process.exit(1);
}

const text = readFileSync(FILE, "utf8");
const filled = new RegExp(`^${NAME}=.+$`, "mu");

if (filled.test(text)) process.exit(0);

const secret = randomBytes(32).toString("base64");
const line = `${NAME}=${secret}`;
const empty = new RegExp(`^${NAME}=s*$`, "mu");

writeFileSync(FILE, empty.test(text) ? text.replace(empty, line) : `${text.trimEnd()}\n${line}\n`);

console.log(`создан мастер-ключ шифрования в ${FILE}.`);
console.log("БЕЗ НЕГО КЛЮЧИ УЧАСТНИКОВ НЕ ЧИТАЮТСЯ — не теряйте этот файл.");
