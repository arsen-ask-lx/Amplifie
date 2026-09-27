#!/usr/bin/env node
/**
 * Хук «правка — только после чтения файла целиком» (task-124). Правила — в
 * `tools/agent/read-guard-rules.mjs`; здесь только диск, журнал и ответ Claude Code.
 *
 * События (настройки — `.claude/settings.json`):
 * - PostToolUse Read → журнал: какие строки пришли;
 * - PostToolUse Edit/Write/MultiEdit → журнал: своя правка;
 * - PreToolUse Edit/Write/MultiEdit → отказ, если файл не прочитан целиком;
 * - PreToolUse Bash/PowerShell → отказ правке на месте непрочитанного; время начала;
 * - PostToolUse/PostToolUseFailure Bash/PowerShell → что команда изменила мимо чтения —
 *   сообщение агенту и строка в `tmp/agent/blind-writes.log`; упавшая команда тоже
 *   могла успеть записать;
 * - SessionStart compact|clear → журнал сессии обнуляется.
 *
 * ⚠️ ЖУРНАЛ СВОЙ У КАЖДОГО ПОДАГЕНТА (`agent_id`): прочитанное подагентом главный видел
 * только пересказом — и наоборот. Журнал дописывается строками: Read зовут пачкой,
 * хуки идут одновременно, и «прочитал JSON — дописал — записал» терял бы записи.
 * Битая строка (запись прервана таймаутом) пропускается и записывается в журнал
 * ошибок: иначе одна строка выключила бы хук до конца сессии.
 *
 * ⚠️ СВОЯ ОШИБКА — ГРОМКО, НО НЕ ОСТАНОВКОЙ. Упавший хук не должен вставать поперёк всей
 * работы: выход 0, `systemMessage` агенту и строка в `tmp/agent/hook-errors.log`. Правила
 * грузятся внутри `try`: при статическом импорте сломанный модуль правил ронял хук ДО
 * обработчика — молча, без записи (живой случай 27.09, ревью task-124).
 *
 * ⚠️ КОРЕНЬ — ПАПКА ПРОЕКТА, А НЕ ТЕКУЩАЯ. После `cd frontend` рабочая папка сессии
 * другая; журнал ушёл бы в `frontend/tmp/`, а пути `git status` — всегда от корня.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const EDITS = new Set(["Edit", "Write", "MultiEdit"]);
const SHELLS = new Set(["Bash", "PowerShell"]);
const DIR = "tmp/agent/reads";
/** Метка начала команды старше этого — от команды, после которой хук не позвали. */
const STALE_MS = 3_600_000;

/** Правила — из `read-guard-rules.mjs`; грузятся в обработчике, см. шапку. */
let rules;

const root = (input) => process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

function journalOf(input) {
  const who = input.agent_id ? `${input.session_id}-${input.agent_id}` : input.session_id;
  return join(root(input), DIR, `${who}.jsonl`);
}

function append(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

function note(input, file, line) {
  append(join(root(input), "tmp/agent", file), `${new Date().toISOString()} ${line}`);
}

function events(input) {
  const path = journalOf(input);
  if (!existsSync(path)) return [];
  const parsed = [];
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      note(
        input,
        "hook-errors.log",
        `битая строка журнала ${path} пропущена: ${line.slice(0, 80)}`,
      );
    }
  }
  return parsed;
}

function stamp(absolute) {
  const stat = statSync(absolute);
  return { size: stat.size, mtime: Math.round(stat.mtimeMs) };
}

const absolute = (input, path) => (isAbsolute(path) ? path : join(root(input), path));

/**
 * Файлы, изменённые в рабочем дереве: путь → время изменения. Удалённые не в счёт:
 * у них нет времени, и они не «правка без чтения» — иначе незакоммиченное удаление
 * давало бы ложную тревогу после каждой команды (ревью task-124).
 */
function dirty(cwd) {
  const run = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
  });
  const found = new Map();
  for (const one of rules.parseStatus(run.stdout ?? "")) {
    if (one.deleted) continue;
    try {
      found.set(one.path, stamp(join(cwd, one.path)).mtime);
    } catch {
      // Пропал между `git status` и нашим взглядом — не правка.
    }
  }
  return found;
}

/** Известно ли содержимое файла сейчас: прочитан целиком или свой, и не менялся снаружи. */
function knownNow(state, input, path) {
  const entry = state.get(path);
  if (!entry?.known) return false;
  try {
    return rules.sameStamp(stamp(absolute(input, path)), entry);
  } catch {
    return false;
  }
}

/** Строк в файле на диске: Read считает ещё и пустую после последнего перевода строки. */
function linesOnDisk(full) {
  const text = readFileSync(full, "utf8");
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function onRead(input) {
  const span = rules.readSpan(input.tool_response);
  const target = input.tool_response?.file?.filePath;
  if (!span || !target) return;
  const full = absolute(input, target);
  append(journalOf(input), {
    t: "read",
    path: rules.relPath(target, root(input)),
    ...span,
    lines: linesOnDisk(full),
    ...stamp(full),
  });
}

function onOwnEdit(input) {
  const target = input.tool_input?.file_path;
  if (!target) return;
  append(journalOf(input), {
    t: "own",
    path: rules.relPath(target, root(input)),
    // Write отвечает `type: "create"`, если файла не было (снято 27.09): своё новое известно.
    created: input.tool_response?.type === "create",
    ...stamp(absolute(input, target)),
  });
}

function beforeEdit(input) {
  const target = input.tool_input?.file_path;
  if (!target) return null;
  const path = rules.relPath(target, root(input));
  const full = absolute(input, target);
  const file = existsSync(full) ? { ...stamp(full), text: readFileSync(full, "utf8") } : null;
  const entry = rules.stateOf(events(input)).get(path);
  return rules.decideEdit({ tool: input.tool_name, path, input: input.tool_input, file, entry });
}

function startPath(input) {
  return join(root(input), DIR, `start-${input.tool_use_id}`);
}

/** Удалить метки начала, после которых хук так и не позвали: их команда давно кончилась. */
function sweep(input) {
  const dir = join(root(input), DIR);
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("start-")) continue;
    const at = Number(readFileSync(join(dir, name), "utf8"));
    // Пустая или битая метка тоже мусор: `NaN` в сравнении не удалил бы её никогда.
    if (!Number.isFinite(at) || Date.now() - at > STALE_MS)
      rmSync(join(dir, name), { force: true });
  }
}

function beforeShell(input) {
  const command = String(input.tool_input?.command ?? "");
  const state = rules.stateOf(events(input));
  const verdict = rules.decideShell({
    command,
    known: (path) => knownNow(state, input, rules.relPath(path, root(input))),
    exists: (path) => existsSync(absolute(input, path)),
  });
  if (verdict.allow && input.tool_use_id) {
    // Только время начала: `git status` — один раз, после команды (П-6).
    mkdirSync(join(root(input), DIR), { recursive: true });
    sweep(input);
    writeFileSync(startPath(input), String(Date.now()));
  }
  return verdict;
}

function afterShell(input) {
  const mark = startPath(input);
  if (!existsSync(mark)) return null;
  const start = Number(readFileSync(mark, "utf8"));
  rmSync(mark, { force: true });
  if (!Number.isFinite(start)) {
    // Битая метка — сверить не с чем; молча промолчать значило бы пропустить запись.
    note(input, "hook-errors.log", `битая метка начала ${mark} — проверка после команды пропущена`);
    return null;
  }
  const changed = rules
    .changedSince(dirty(root(input)), start)
    .filter((path) => !path.startsWith("tmp/"));
  if (changed.length === 0) return null;
  const command = String(input.tool_input?.command ?? "");
  if (rules.isFormatter(command)) {
    // Форматтер правит законно: своя правка — прочитанное остаётся прочитанным.
    for (const path of changed) {
      append(journalOf(input), { t: "own", path, created: false, ...stamp(absolute(input, path)) });
    }
    return null;
  }
  const state = rules.stateOf(events(input));
  const blind = changed.filter((path) => !state.get(path)?.known);
  if (blind.length === 0) return null;
  note(input, "blind-writes.log", `${blind.join(", ")} ← ${command.slice(0, 160)}`);
  return (
    `Команда изменила файлы, которые ты не читал целиком: ${blind.join(", ")}. ` +
    "Правило task-124: правка — после чтения целиком и инструментом Edit. " +
    "ПОЧИНИТЬ: прочитай их целиком (Read) и проверь, что изменено то, что задумано."
  );
}

function onSessionStart(input) {
  if (["compact", "clear"].includes(input.source)) append(journalOf(input), { t: "reset" });
}

/** До действия: отказ уходит агенту причиной с кодом 2. */
function onBefore(input) {
  const verdict = EDITS.has(input.tool_name) ? beforeEdit(input) : beforeShell(input);
  if (verdict && !verdict.allow) {
    process.stderr.write(verdict.reason);
    process.exitCode = 2;
  }
}

/** После команды оболочки: изменённое мимо чтения — сообщением агенту. */
function onAfterShell(input) {
  const text = afterShell(input);
  if (!text) return;
  const hookSpecificOutput = { hookEventName: input.hook_event_name, additionalContext: text };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

/** Что делать после инструмента `tool`: обработчик или null. */
function afterTool(tool) {
  if (tool === "Read") return onRead;
  if (EDITS.has(tool)) return onOwnEdit;
  return SHELLS.has(tool) ? onAfterShell : null;
}

/** Обработчик по событию: `(tool) => обработчик | null`. */
const HANDLERS = {
  SessionStart: () => onSessionStart,
  PreToolUse: (tool) => (EDITS.has(tool) || SHELLS.has(tool) ? onBefore : null),
  PostToolUse: afterTool,
  PostToolUseFailure: (tool) => (SHELLS.has(tool) ? onAfterShell : null),
};

function answer(input) {
  const event = input.hook_event_name;
  // Свои ключи, а не прототип: имя события `toString` не должно стать «хук упал».
  if (Object.hasOwn(HANDLERS, event)) HANDLERS[event](input.tool_name)?.(input);
}

let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", async () => {
  let input = {};
  try {
    input = JSON.parse(raw);
    rules = await import("../../tools/agent/read-guard-rules.mjs");
    answer(input);
  } catch (error) {
    try {
      note(
        input,
        "hook-errors.log",
        `${input.hook_event_name ?? "?"} ${input.tool_name ?? ""}: ${error?.stack ?? error}`,
      );
    } catch {
      // Записать некуда — остаётся сообщение агенту ниже.
    }
    process.stdout.write(
      JSON.stringify({ systemMessage: `хук чтения упал и пропустил действие: ${String(error)}` }),
    );
    process.exitCode = 0;
  }
});
