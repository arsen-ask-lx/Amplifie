#!/usr/bin/env node
/**
 * Сторож правил по путям (task-126): `.claude/rules/*.md` находят файлы и называют
 * существующие скиллы. Правило — `rules-paths-rule.mjs`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { problemsOf } from "./rules-paths-rule.mjs";

const RULES = ".claude/rules";
const SKILLS = ".claude/skills";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const skills = readdirSync(SKILLS).filter((one) => existsSync(`${SKILLS}/${one}/SKILL.md`));
const rules = existsSync(RULES) ? readdirSync(RULES).filter((one) => one.endsWith(".md")) : [];

let bad = 0;
for (const name of rules) {
  for (const problem of problemsOf(readFileSync(`${RULES}/${name}`, "utf8"), files, skills)) {
    console.error(`${RULES}/${name}: ${problem}`);
    bad += 1;
  }
}
if (bad > 0) {
  console.error(
    "\nПОЧИНИТЬ: шаблон — на существующие файлы, скилл — по имени папки в .claude/skills.",
  );
  process.exit(1);
}
console.log(`правила по путям: ${rules.length}, все находят файлы и скиллы — OK`);
