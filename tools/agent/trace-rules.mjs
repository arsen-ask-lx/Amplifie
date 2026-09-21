/**
 * Сверка «план заявил — агент сделал» по записи сессии (task-109).
 *
 * ЗАЧЕМ. Владелец 21.09: «первый план агент пишет плохой — не читает нужные
 * файлы». В тот же день в task-108 было написано «прочитано целиком» про
 * девять файлов, а целиком открыты два. Строку «прочитано» пишет тот же,
 * кто читал, — значит проверять её должен не он, а запись того, что он делал.
 *
 * ⚠️ СУДИМ ПО ДЕЛАМ, А НЕ ПО РАЗМЫШЛЕНИЯМ. В записи Claude Code 87% блоков
 * размышлений пустые (замер 21.09), а те, что есть, не обязаны называть
 * настоящую причину решения. Вызовы инструментов лежат в ней полностью.
 *
 * ⚠️ ЧИСТЫЕ ПРАВИЛА ОТДЕЛЬНО ОТ ЗАПУСКА, как у `map-rule.mjs`: здесь нет
 * файловой системы, поэтому каждое правило проверяется подсаженным случаем
 * в `trace-rules.test.mjs`, а не рассуждением.
 */

/** Путь к файлу — от корня репозитория, прямыми косыми. */
export function normPath(raw, root = "Amplifie") {
  const path = String(raw)
    .replace(/^["']|["']$/gu, "")
    .replace(/\\/gu, "/");
  const inside = new RegExp(`^.*?/${root}/`, "iu");
  return path.replace(inside, "").replace(/^\.\//u, "");
}

/** Слова команды с учётом кавычек. */
function words(stage) {
  return (stage.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []).map((one) =>
    one.replace(/^["']|["']$/gu, ""),
  );
}

/** Команда пишет или берёт вход из встроенного текста — это не чтение файла. */
const redirects = (tokens) => tokens.some((one) => /^(?:>|>>|<<)/u.test(one));

const fileArgs = (tokens) =>
  tokens.slice(1).filter((one) => !one.startsWith("-") && !/^\d+$/u.test(one));

/** Сколько строк просит `head`: `-80`, `-n 80`, `-n80`; по умолчанию десять. */
function headCount(tokens) {
  for (let n = 1; n < tokens.length; n += 1) {
    const one = tokens[n];
    if (/^-\d+$/u.test(one)) return Number(one.slice(1));
    if (one === "-n" && /^\d+$/u.test(tokens[n + 1] ?? "")) return Number(tokens[n + 1]);
    if (/^-n\d+$/u.test(one)) return Number(one.slice(2));
  }
  return 10;
}

/** Диапазоны `sed -n '225,270p;300p'`. */
function sedRanges(script) {
  const ranges = [];
  for (const found of script.matchAll(/(\d+)(?:,(\d+))?p/gu)) {
    const from = Number(found[1]);
    ranges.push([from, found[2] ? Number(found[2]) : from]);
  }
  return ranges;
}

/** `cat файл` — целиком; `cat файл | head -N` — начало; иначе вывод ушёл дальше. */
function catReads(tokens, stages) {
  if (stages.length === 1) return fileArgs(tokens).map((path) => ({ path, range: "all" }));
  const next = words(stages[1] ?? "");
  if (stages.length === 2 && next[0] === "head") {
    return fileArgs(tokens).map((path) => ({ path, range: [1, headCount(next)] }));
  }
  return [];
}

const headReads = (tokens) =>
  fileArgs(tokens).map((path) => ({ path, range: [1, headCount(tokens)] }));

/** `sed -n 'a,bp' файл` — диапазоны; `sed -i` правит файл, а не показывает. */
function sedReads(tokens) {
  if (!tokens.includes("-n") || tokens.some((one) => one.startsWith("-i"))) return [];
  const [script, ...paths] = tokens.slice(1).filter((one) => one !== "-n");
  return paths.flatMap((path) => sedRanges(script ?? "").map((range) => ({ path, range })));
}

/** Сколько строк просит PowerShell: `-TotalCount N`, `-First N`, `-Head N`. */
function psCount(tokens) {
  const at = tokens.findIndex((one) => /^-(?:TotalCount|First|Head)$/iu.test(one));
  return at < 0 ? null : Number(tokens[at + 1]);
}

/**
 * `Get-Content файл` — целиком; с `-TotalCount N` или `| Select-Object -First N` —
 * начало; `-Tail` и прочий конвейер — хвост или обработка, не чтение подряд.
 * PowerShell здесь — вторая оболочка агента (разбор критика 21.09: 98 вызовов).
 */
function getContentReads(tokens, stages) {
  if (tokens.some((one) => /^-Tail$/iu.test(one))) return [];
  const paths = tokens
    .slice(1)
    .filter((one, n, all) => !one.startsWith("-") && !/^-/u.test(all[n - 1] ?? ""));
  const next = words(stages[1] ?? "");
  const count = psCount(tokens) ?? (/^Select-Object$/iu.test(next[0] ?? "") ? psCount(next) : null);
  if (stages.length > 1 && count === null) return [];
  return paths.map((path) => ({ path, range: count === null ? "all" : [1, count] }));
}

const READERS = { cat: catReads, head: headReads, sed: sedReads, "Get-Content": getContentReads };

/**
 * Что открыла одна команда оболочки: `[{ path, range }]`, где `range` —
 * `[с, по]` или `"all"`. Читает файл только ПЕРВОЕ звено конвейера —
 * дальше идёт уже его вывод.
 */
export function shellReads(command) {
  return command.split(/\s*(?:&&|\|\||;|\n)\s*/u).flatMap((chain) => {
    const stages = chain.split(/\s*\|\s*/u);
    const tokens = words(stages[0] ?? "");
    const reader = READERS[tokens[0] ?? ""];
    if (!reader || redirects(tokens)) return [];
    return reader(tokens, stages);
  });
}

/** Время записи строки: у каждой строки сессии оно своё. */
const timeOf = (record) => Date.parse(record.timestamp ?? "") || 0;

/** Строки записи самого автора до минуты `until`: подагенты не в счёт. */
function* ownRecords(records, until) {
  for (const record of records) {
    if (record.isSidechain) continue;
    if (until !== null && timeOf(record) >= until) return;
    yield record;
  }
}

/** Просьба автора: команда оболочки или правка файла. */
function callEvent(block, at) {
  if (block.name === "Bash" || block.name === "PowerShell")
    return { kind: "shell", command: String(block.input?.command ?? ""), at };
  if (block.name === "Edit" || block.name === "Write") {
    return { kind: "edit", path: String(block.input?.file_path ?? ""), at };
  }
  return null;
}

/** Ответ на чтение инструментом: какие строки пришли и сколько их в файле. */
function readEvent(file, at) {
  const start = Number(file.startLine ?? 1);
  return {
    kind: "read",
    path: file.filePath,
    range: [start, start + Number(file.numLines ?? 0) - 1],
    total: Number(file.totalLines ?? 0) || null,
    at,
  };
}

/**
 * Одно событие из блока записи — или null.
 *
 * ⚠️ ОБРЕЗАННЫЙ ВЫВОД — НЕ ЧТЕНИЕ (разбор критика 21.09). Вывод команды
 * длиннее порога Claude Code обрезает до превью, и `cat` большого файла
 * показывает начало, а не файл. Признак `truncated` ставит запуск, разбирая
 * ответ; здесь он помечает уже заведённое событие команды.
 */
function eventOf(block, record, asked) {
  const at = timeOf(record);
  if (block.type === "tool_use") {
    const event = callEvent(block, at);
    asked.set(block.id, { name: block.name, event });
    return event;
  }
  const call = asked.get(block.tool_use_id);
  if (block.type === "tool_result" && block.truncated && call?.event) call.event.truncated = true;
  const file = record.toolUseResult?.file;
  return block.type === "tool_result" && file && call?.name === "Read" ? readEvent(file, at) : null;
}

/**
 * События чтения из записи сессии — до момента `until`, если он назван.
 *
 * ⚠️ ЧТЕНИЕ ИНСТРУМЕНТОМ БЕРЁТСЯ ИЗ ОТВЕТА, А НЕ ИЗ ПРОСЬБЫ. Просьба говорит
 * «открой с восьмидесятой строки», а сколько строк реально пришло и сколько
 * их в файле, знает только ответ (`toolUseResult.file`).
 *
 * ⚠️ ПОДАГЕНТЫ НЕ В СЧЁТ (`isSidechain`). Прочитанное подагентом автор
 * видел пересказом, а не глазами, — ровно так и возникла ложь в task-108.
 *
 * ⚠️ ДАВНЕЕ НЕ В СЧЁТ (`since`). Чтение двухнедельной давности — это чтение
 * другого файла: он с тех пор менялся, а правки владельца в записи агента
 * не видны вовсе.
 */
export function readsFrom(records, until = null, since = null) {
  const events = [];
  const asked = new Map();
  for (const record of ownRecords(records, until)) {
    const fresh = since === null || timeOf(record) >= since;
    for (const block of record.message?.content ?? []) {
      const event = eventOf(block, record, asked);
      if (event && fresh) events.push(event);
    }
  }
  return events;
}

/** Добавить диапазон, склеив пересекающиеся и соседние. */
function addRange(ranges, [from, to]) {
  const all = [...ranges, [from, to]].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const one of all) {
    const last = merged.at(-1);
    if (last && one[0] <= last[1] + 1) last[1] = Math.max(last[1], one[1]);
    else merged.push([...one]);
  }
  return merged;
}

/** Отметить открытые строки файла. */
function noteRead(seen, path, { range, total, at }, linesOf) {
  const known = seen.get(path) ?? { ranges: [], total: null, lastAt: 0 };
  // Файл стал другой длины — куски прежней версии не складываются с новыми.
  const changed = total !== null && known.total !== null && total !== known.total;
  const ranges = changed ? [] : known.ranges;
  const onDisk = linesOf(path);
  const size = total ?? known.total ?? onDisk;
  const span = range === "all" ? [1, size ?? Number.MAX_SAFE_INTEGER] : range;
  seen.set(path, {
    ranges: addRange(ranges, span),
    total: size ?? null,
    lastAt: Math.max(known.lastAt, at ?? 0),
    // Файла по этому пути больше нет — читали то, чего в проекте уже нет.
    gone: onDisk === null,
  });
}

/**
 * Какие строки каждого файла открывались: `Map<путь, { ranges, total }>`.
 * `linesOf(путь)` — сколько строк в файле сейчас; нужно для команд оболочки,
 * которые, в отличие от чтения инструментом, числа строк не сообщают.
 */
export function coverageOf(events, linesOf, root = "Amplifie") {
  const seen = new Map();
  for (const event of events) {
    if (event.kind === "edit") {
      // Агент сам поменял файл: прочитанное до правки описывает другой текст.
      const path = normPath(event.path, root);
      if (seen.has(path)) seen.set(path, { ...seen.get(path), ranges: [] });
    } else {
      for (const one of readsOf(event)) {
        noteRead(seen, normPath(one.path, root), { ...one, at: event.at }, linesOf);
      }
    }
  }
  return seen;
}

/** Что открыло событие: чтение инструментом или команда, чей вывод дошёл целиком. */
function readsOf(event) {
  if (event.truncated) return [];
  if (event.kind === "read") return [{ path: event.path, range: event.range, total: event.total }];
  return shellReads(event.command).map((one) => ({ ...one, total: null }));
}

/** Похоже ли слово в обратных кавычках на имя файла, а не функции. */
const looksLikeFile = (token) => /\.[a-z]{1,5}$/iu.test(token) && !/\s/u.test(token);

/** Новая форма (с task-109): строки таблицы «файл | строк | как», где «как» — «целиком». */
const tableClaims = (plan) =>
  plan
    .split("\n")
    .map((line) => /^\|\s*`([^`]+)`\s*\|\s*(\d+)?\s*\|\s*целиком/u.exec(line)?.[1])
    .filter(Boolean);

/**
 * Старая форма: абзац «Прочитано целиком: `a`, `b` (`функция`)». Берутся
 * слова с расширением, имена функций и заголовков — нет. С начала строки:
 * посреди фразы эти слова — рассказ о форме, а не заявление.
 */
function oldClaims(plan) {
  const paragraph = /(?:^|\n)Прочитано целиком:([\s\S]*?)(?:\n\s*\n|$)/u.exec(plan)?.[1] ?? "";
  return [...paragraph.matchAll(/`([^`]+)`/gu)].map((found) => found[1]).filter(looksLikeFile);
}

/**
 * Что план заявил прочитанным ЦЕЛИКОМ. «Фрагмент» назван честно —
 * проверять его не на что.
 */
export function claimsIn(plan) {
  return [...new Set([...tableClaims(plan), ...oldClaims(plan)])].map((file) => ({ file }));
}

/**
 * Запись файла плана, которая САМА заявляет прочитанное: строка таблицы
 * «целиком» или абзац «Прочитано целиком:». Слово «прочитано» в любой другой
 * правке момент не сдвигает — иначе поздняя правка задним числом оправдывала
 * бы заявление (разбор критика 21.09).
 */
function isClaim(block, planName) {
  if (block.type !== "tool_use" || !["Write", "Edit"].includes(block.name)) return false;
  const path = String(block.input?.file_path ?? "");
  const text = String(block.input?.content ?? block.input?.new_string ?? "");
  return path.includes(planName) && claimsIn(text).length > 0;
}

/**
 * Когда план сделал заявление: последняя запись файла плана с заявлением.
 * Сверять надо с тем, что было открыто к этой минуте, — прочитанное позже
 * заявление задним числом не оправдывает.
 */
export function claimTime(records, planName) {
  let when = null;
  for (const record of ownRecords(records, null)) {
    if ((record.message?.content ?? []).some((block) => isClaim(block, planName)))
      when = timeOf(record);
  }
  return when;
}

/**
 * Склеить короткий путь с длинным, концом которого он является.
 *
 * ⚠️ ЭТО ОДИН ФАЙЛ, ПРОЧИТАННЫЙ ИЗ РАЗНЫХ ПАПОК. Команда `cd frontend/src/data
 * && cat useReading.ts` оставляет в записи короткий путь, чтение инструментом —
 * полный. Разными файлами их считать нельзя: так `useReading.ts` в task-108
 * оказался «неоднозначным» сам с собой (живой прогон 21.09).
 */
function mergeSuffixes(matches) {
  const sorted = [...matches].sort((a, b) => b.path.length - a.path.length);
  const kept = [];
  for (const one of sorted) {
    const longer = kept.find((other) => other.path.endsWith(`/${one.path}`));
    if (!longer) {
      kept.push({ ...one, ranges: [...one.ranges] });
      continue;
    }
    for (const range of one.ranges) longer.ranges = addRange(longer.ranges, range);
    longer.lastAt = Math.max(longer.lastAt, one.lastAt);
  }
  return kept;
}

/** Сколько строк файла открыто. */
function seenLines({ ranges, total }) {
  const limit = total ?? Number.MAX_SAFE_INTEGER;
  return ranges.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(to, limit) - from + 1), 0);
}

/** Кандидаты под имя из плана: склеенные, с открытыми строками. */
function candidatesFor(file, coverage) {
  const wanted = file.replace(/\\/gu, "/");
  const matches = [...coverage.entries()]
    .filter(([path]) => path === wanted || path.endsWith(`/${wanted}`))
    .map(([path, entry]) => ({ path, ...entry }));
  return mergeSuffixes(matches).filter((one) => one.ranges.length > 0);
}

const isFull = (one) => one.total !== null && one.seen >= one.total;
const listed = (many) => many.map((one) => one.path).join(", ");

/** Вердикт по одному заявлению. */
function judge(file, coverage) {
  const found = candidatesFor(file, coverage);
  if (found.length === 0) return { file, status: "не открыт", seen: 0, total: null };
  const alive = found.filter((one) => !one.gone);
  if (alive.length === 0)
    return { file, status: "файла нет", seen: 0, total: null, path: listed(found) };
  const scored = alive.map((one) => ({
    path: one.path,
    seen: seenLines(one),
    total: one.total,
    lastAt: one.lastAt,
  }));
  const allFull = scored.every(isFull);
  if (scored.length > 1 && !allFull) {
    return { file, status: "неоднозначно", seen: 0, total: null, path: listed(scored) };
  }
  return { file, status: allFull ? "целиком" : "частично", ...scored[0] };
}

/**
 * Вердикт по каждому заявлению: `целиком`, `частично`, `не открыт`,
 * `файла нет` или `неоднозначно`.
 *
 * ⚠️ «НЕОДНОЗНАЧНО» ЧЕСТНЕЕ, ЧЕМ УГАДАТЬ. План назвал `service.ts`, а таких
 * файлов в проекте несколько. Заявлению верим, только если открыты целиком
 * ВСЕ одноимённые: иначе засчитался бы не тот. Так и было в task-108 —
 * имелся в виду `talk/service.ts` на 905 строк, а засчитался `identity/`
 * на 212 (живой прогон 21.09). Полный путь в таблице снимает вопрос.
 */
export function verdict(claims, coverage) {
  return claims.map(({ file }) => judge(file, coverage));
}

/** Вызов критика по этому плану: агент `plan-critic` или его инструкция в задании. */
function isCritic(block, planName) {
  if (block.type !== "tool_use" || block.name !== "Agent") return false;
  const prompt = String(block.input?.prompt ?? "");
  const critic = block.input?.subagent_type === "plan-critic" || prompt.includes("plan-critic");
  return critic && prompt.includes(planName);
}

/**
 * Звали ли критика по этому плану после заявления.
 *
 * ⚠️ ГЕЙТ ПЛАНА ПРОВЕРЯЕТ ФОРМУ, А ЭТО — ФАКТ (разбор критика 21.09). Строку
 * «Замечаний нет» автор может написать сам, не зовя никого; в конвейере это
 * не отличить. Отличить можно только по записи сессии — здесь.
 */
export function criticRan(records, planName, since) {
  for (const record of ownRecords(records, null)) {
    if (since !== null && timeOf(record) < since) continue;
    if ((record.message?.content ?? []).some((block) => isCritic(block, planName))) return true;
  }
  return false;
}
