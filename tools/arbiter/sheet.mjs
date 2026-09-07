/**
 * Лист разметки: обычный текстовый файл, который правят в редакторе.
 *
 * ПОЧЕМУ НЕ ДИАЛОГ В ТЕРМИНАЛЕ. Первая версия спрашивала по одной реплике
 * через readline. Она отказывалась работать там, где владелец работает
 * на самом деле: ни в Claude Code, ни через `!команда` терминала нет.
 * Проверено было только то, что инструмент честно отказывается, — но не то,
 * что он где-то работает. Записано в журнал шишек.
 *
 * У листа есть и достоинства помимо доступности: ответы видны все сразу,
 * их можно менять, файл ложится в git и показывает историю мнения.
 */

const UNANSWERED = "?";

const YES = new Set(["д", "da", "d", "да", "y", "yes"]);
const NO = new Set(["н", "n", "нет", "no"]);

/**
 * Разбор листа. Возвращает ответы и список непонятных строк.
 *
 * Непонятное НЕ проглатывается: опечатка в ответе, принятая за «не отвечено»,
 * тихо уменьшает выборку, и каппа считается по меньшему числу строк,
 * чем думает человек.
 */
/**
 * Одна строка листа → что она значит.
 *
 * `skip` — пустая строка, комментарий или неотвеченное. `why` — почему
 * строка непонятна. Разбор строки отделён от обхода файла: вместе они
 * дают ветвление, за которым уже не уследить глазами.
 */
function classify(raw) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return { skip: true };

  const match = /^(c\d+)\s*=\s*(.*)$/u.exec(line);
  if (!match) return { line, why: "не похоже на «cNNN = ответ»" };

  const answer = (match[2] ?? "").trim().toLowerCase();
  if (answer === UNANSWERED || answer === "") return { skip: true };
  if (YES.has(answer)) return { id: match[1], label: "agreement" };
  if (NO.has(answer)) return { id: match[1], label: "chatter" };
  return { line, why: `непонятный ответ «${answer}»` };
}

export function parseSheet(text) {
  const answers = {};
  const broken = [];

  for (const [index, raw] of text.split("\n").entries()) {
    const got = classify(raw);
    if (got.skip) continue;
    if (got.why) broken.push({ line: index + 1, text: got.line, why: got.why });
    else answers[got.id] = got.label;
  }

  return { answers, broken };
}

/** Лист для корпуса; уже данные ответы сохраняются. */
export function renderSheet(corpus, existing = {}) {
  const back = { agreement: "д", chatter: "н" };
  const head = [
    "# ЛИСТ РАЗМЕТКИ К2 — вторая, независимая оценка.",
    "#",
    "# Замени ? на д или н в строках вида «cNNN = ?». Остальное не трогай.",
    "#   д — кто-то взял на себя обязательство",
    "#   н — разговор без обязательства",
    "#   ?  — оставить на потом (в подсчёт не идёт)",
    "#",
    "# Отвечай своим суждением. Правильного ответа, записанного где-то рядом,",
    "# нет: смысл ровно в том, чтобы узнать, насколько мы с тобой совпадаем.",
    "# Сохраняй когда угодно — незаполненное просто не считается.",
    "#",
    "# Готово → make arbiter",
    "",
  ];

  const body = corpus.flatMap((item) => [
    `# ${"─".repeat(66)}`,
    ...item.context.map((line) => `#   … ${line}`),
    `#   ➜ ${item.utterance || "«молчание»"}`,
    `${item.id} = ${back[existing[item.id]] ?? UNANSWERED}`,
    "",
  ]);

  return `${[...head, ...body].join("\n")}`;
}
