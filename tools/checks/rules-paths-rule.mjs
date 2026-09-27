/**
 * Правила по путям (`.claude/rules/*.md`) живы (task-126).
 *
 * Правило с `paths:` движок Claude Code кладёт в контекст, когда открыт подходящий файл.
 * Отказов у него два, и оба молчаливые: шаблон не находит ни одного файла (файлы
 * переехали) — правило не сработает никогда; названный скилл переименован — агент
 * ищет то, чего нет. Здесь оба ловятся до коммита.
 *
 * ⚠️ СКИЛЛ УЗНАЁТСЯ ПО ФОРМЕ ИМЕНИ: слово в обратных кавычках из строчных латинских
 * букв и цифр через дефис (`safe-migrations`). Команды (`make cost`) и файлы
 * (`compose.yml`) под форму не подходят — в них пробел или точка.
 */
import { matchesGlob } from "node:path";

const SKILL_NAME = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/gu;

/** Шаблоны из frontmatter: список `paths:` строками `- "шаблон"`. */
export function pathsOf(text) {
  const head = /^---\n([\s\S]*?)\n---/u.exec(text.replace(/\r\n/gu, "\n"))?.[1] ?? "";
  const block = /^paths:\n((?:[ \t]+-[^\n]*\n?)+)/mu.exec(head)?.[1] ?? "";
  return [...block.matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gmu)].map((found) => found[1]);
}

/** Скиллы, которые правило называет. */
export function skillsOf(text) {
  return [...new Set([...text.matchAll(SKILL_NAME)].map((found) => found[1]))];
}

/**
 * Что не так с правилом: `[строки]`. `files` — пути в git от корня,
 * `skills` — имена существующих скиллов.
 */
export function problemsOf(text, files, skills) {
  const patterns = pathsOf(text);
  const named = skillsOf(text);
  const problems = [];
  if (patterns.length === 0)
    problems.push("нет `paths:` — правило грузится всегда, а не по файлам");
  for (const pattern of patterns) {
    if (!files.some((file) => matchesGlob(file, pattern))) {
      problems.push(`шаблон «${pattern}» не находит ни одного файла`);
    }
  }
  if (named.length === 0) problems.push("не названо ни одного скилла");
  for (const skill of named) {
    if (!skills.includes(skill)) problems.push(`скилла «${skill}» нет в .claude/skills`);
  }
  return problems;
}
