/**
 * Запись сессии Claude Code этого проекта — одно чтение на все сверки по ней
 * (`trace-audit.mjs` — план с делом, `review-audit.mjs` — ревью перед коммитом).
 *
 * ⚠️ ТОЛЬКО ЧТЕНИЕ. В записи лежат выводы команд — всё, что агент видел. Отсюда
 * наружу уходят только вызовы инструментов без содержимого прочитанных файлов.
 */
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

/** Папка записей этого проекта: Claude Code называет её путём, где `:` и косые — дефисы. */
export function sessionsDir() {
  return join(homedir(), ".claude", "projects", resolve(".").replace(/[:\\/]/gu, "-"));
}

/** Записи этого проекта со временем изменения, свежие первыми; нет папки — пусто. */
function sessionFiles() {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((one) => one.endsWith(".jsonl"))
    .map((one) => ({ path: join(dir, one), at: statSync(join(dir, one)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
}

/** Самая свежая запись — или null, если записей нет (коммит делает человек без агента). */
export function latestSession() {
  return sessionFiles()[0]?.path ?? null;
}

/** Команды оболочки одной строки записи; обрезанная строка — пусто. */
export function shellCommandsOf(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return []; // первая строка хвоста обрезана посередине — её и пропускаем
  }
  // Сообщение человека несёт `content` строкой, а не списком блоков.
  const content = record?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block.type === "tool_use" && ["Bash", "PowerShell"].includes(block.name))
    .map((block) => String(block.input?.command ?? ""));
}

/**
 * Последние команды оболочки в конце записи: хвоста в 512 КБ хватает с запасом. Несколько,
 * а не одна: коммит зовут и параллельно с другой командой (ревью task-124).
 */
function lastCommands(path, count = 5) {
  const size = statSync(path).size;
  const from = Math.max(0, size - 512 * 1024);
  const buffer = Buffer.alloc(size - from);
  const handle = openSync(path, "r");
  readSync(handle, buffer, 0, buffer.length, from);
  closeSync(handle);
  return buffer.toString("utf8").split("\n").flatMap(shellCommandsOf).slice(-count);
}

/**
 * Запись сессии, которая сейчас делает `git commit`: из свежих — та, среди последних
 * команд оболочки которой есть коммит. Самая свежая может оказаться чужой — рядом работает
 * второй агент (второй разбор критика task-124).
 */
export function sessionOfCommit(withinMinutes = 30) {
  const fresh = sessionFiles().filter((one) => Date.now() - one.at < withinMinutes * 60_000);
  const commits = (one) =>
    lastCommands(one.path).some((command) => /\bgit\b[^|;&]*\bcommit\b/u.test(command));
  return fresh.find(commits)?.path ?? null;
}

/**
 * Claude Code обрезал вывод команды до превью: полный вывод сохранён в файл,
 * а агент увидел только начало (разбор критика 21.09).
 */
const truncated = (block) =>
  /Output too large|persisted-output/u.test(JSON.stringify(block.content ?? ""));

/**
 * Строки записи, нужные сверкам, — без содержимого прочитанных файлов.
 *
 * ⚠️ ЗАПИСЬ ЧИТАЕТСЯ ПОТОКОМ И СРАЗУ ПРОРЕЖИВАЕТСЯ. Запись длинной сессии —
 * сотни мегабайт (184 МБ 21.09); держать её в памяти целиком ради номеров
 * строк незачем.
 */
export async function records(path) {
  const kept = [];
  let broken = 0;
  for await (const line of createInterface({ input: createReadStream(path) })) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      broken += 1;
      continue;
    }
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    if (!content.some((one) => one.type === "tool_use" || one.type === "tool_result")) continue;
    const file = record.toolUseResult?.file;
    kept.push({
      isSidechain: record.isSidechain,
      timestamp: record.timestamp,
      message: {
        content: content.map((one) =>
          one.type === "tool_use"
            ? { type: one.type, id: one.id, name: one.name, input: one.input }
            : { type: one.type, tool_use_id: one.tool_use_id, truncated: truncated(one) },
        ),
      },
      ...(file ? { toolUseResult: { file: { ...file, content: undefined } } } : {}),
    });
  }
  if (broken > 0) console.log(`строк записи не разобрано: ${broken}`);
  return kept;
}
