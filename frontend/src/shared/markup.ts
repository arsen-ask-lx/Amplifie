/**
 * Разбор разметки сообщения (Р-002).
 *
 * ЧТО ЭТО НЕ ДЕЛАЕТ: не производит HTML. Совсем. На выходе — список кусков,
 * который отрисовывается обычными узлами React. Строки с разметкой в DOM
 * не попадают, поэтому целого класса дыр (внедрение HTML) просто нет.
 *
 * ГЛАВНОЕ ПРО ССЫЛКИ. React обеззараживает ТЕКСТ, но НЕ атрибуты: `href`
 * со схемой `javascript:` он вставит как есть, и по нажатию выполнится код
 * с правами вошедшего. На этом уже обожглись — в paperclip нашли хранимый
 * XSS ровно так. Поэтому схема проверяется по белому списку, а не по
 * чёрному: запретить перечислением нельзя, схем больше, чем воображения.
 *
 * ПОДМНОЖЕСТВО ВЗЯТО У ТЕЛЕГРАМА: жирный, курсив, подчёркнутый,
 * зачёркнутый, моноширинный, блок кода, скрытый и ссылка. Расширять
 * можно — сужать НЕЛЬЗЯ: накопленные сообщения перестанут выглядеть так,
 * как их писали.
 */

export type Token =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "underline"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "code"; text: string }
  /** Многострочный кусок кода. Отдельно от `code`: рисуется блоком. */
  | { kind: "pre"; text: string }
  /** Скрытый до нажатия. У Телеграма — «спойлер». */
  | { kind: "spoiler"; text: string }
  | { kind: "link"; text: string; href: string };

/** Единственные схемы, которым разрешено оказаться в href. */
const ALLOWED = new Set(["http:", "https:"]);

/**
 * Годная ссылка либо null.
 *
 * Разбираем настоящим разборщиком адресов, а не регуляркой: `java\tscript:`,
 * `JavaScript:`, `javascript:` и прочие написания регулярка пропускает,
 * а разборщик приводит к одному виду и называет схему честно.
 */
export function safeHref(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return ALLOWED.has(parsed.protocol) ? parsed.href : null;
  } catch {
    // Не разобралось — значит это не абсолютный адрес. Относительные
    // ссылки в сообщениях не поддерживаем: они увели бы внутрь приложения.
    return null;
  }
}

/**
 * ⚠️ ПОРЯДОК ВЕТОК ЗНАЧИМ, А НЕ ПРОИЗВОЛЕН. Регулярка берёт ПЕРВОЕ
 * подошедшее из перечисленных, поэтому длинные обёртки обязаны стоять
 * раньше коротких: тройная кавычка перед одинарной, `**` перед `*`.
 * Переставь местами — и блок кода развалится на куски по одной кавычке,
 * а жирный станет двумя курсивами подряд.
 *
 * ⚠️ ОДИНАРНОЕ `_` НЕ ПОДДЕРЖАНО, хотя у Телеграма оно есть. Оно рвёт
 * `имя_переменной` и пути, которых в рабочей переписке больше, чем
 * курсива; курсив пишется звёздочками. Единственное сознательное
 * расхождение с их разметкой.
 */
const PATTERN = new RegExp(
  [
    "```\\n?([\\s\\S]+?)```", // блок кода
    "`([^`\\n]+)`", // моноширинный
    "\\*\\*([^*\\n]+)\\*\\*", // жирный
    "__([^_\\n]+)__", // подчёркнутый
    "~~([^~\\n]+)~~", // зачёркнутый
    "\\|\\|([^|\\n]+)\\|\\|", // скрытый
    "\\*([^*\\n]+)\\*", // курсив
    "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)", // ссылка с подписью
    "(https?://[^\\s<>()]+)", // голый адрес
  ].join("|"),
  "gu",
);

/** Хвостовая пунктуация к адресу не относится: «см. http://a.b.» */
const TRAILING = /[.,!?;:»"']+$/u;

/**
 * Ссылка с подписью.
 *
 * ⚠️ ПРИ НЕГОДНОЙ СХЕМЕ ПОКАЗЫВАЕМ ЗАПИСЬ ЦЕЛИКОМ, А НЕ ОДНУ ПОДПИСЬ.
 * Так и было сказано в этом комментарии с самого начала — «человек
 * написал это и должен увидеть, что именно он написал», — а код отдавал
 * только подпись и молча съедал адрес. Разошлись они незаметно: в ленте
 * подпись выглядит осмысленно, и никому не приходит в голову, что
 * `[тык](javascript:…)` показан не полностью. Поймано кругом
 * «строка → поле → строка»: правка такой реплики переписывала её.
 */
function linkToken(raw: string, text: string, rawHref: string): Token {
  const href = safeHref(rawHref);
  return href ? { kind: "link", text, href } : { kind: "text", text: raw };
}

function bareToken(raw: string): { token: Token; tail: string } {
  const trimmed = raw.replace(TRAILING, "");
  const tail = raw.slice(trimmed.length);
  const href = safeHref(trimmed);
  return {
    token: href ? { kind: "link", text: trimmed, href } : { kind: "text", text: trimmed },
    tail,
  };
}

/**
 * Какой ветке какой вид куска. Порядок пар обязан совпадать с порядком
 * веток в самой регулярке — держать это списком, а не лестницей `if`,
 * дешевле: при добавлении ветки видно, что список стал длиннее.
 */
const KINDS = ["pre", "code", "bold", "underline", "strike", "spoiler", "italic"] as const;

function tokenOf(match: RegExpExecArray): { token: Token; tail: string } {
  for (let i = 0; i < KINDS.length; i++) {
    const text = match[i + 1];
    const kind = KINDS[i];
    if (text !== undefined && kind !== undefined) return { token: { kind, text }, tail: "" };
  }

  // Ветки ссылки и голого адреса идут сразу за семью видами обёрток.
  const linkText = match[KINDS.length + 1];
  const linkHref = match[KINDS.length + 2];
  if (linkText !== undefined && linkHref !== undefined) {
    return { token: linkToken(match[0], linkText, linkHref), tail: "" };
  }

  const bare = match[KINDS.length + 3];
  if (bare !== undefined) return bareToken(bare);
  return { token: { kind: "text", text: match[0] }, tail: "" };
}

/**
 * Разобрать текст на куски. Вложенности нет намеренно: `**жирная [ссылка]()**`
 * останется жирным текстом со скобками. Предсказуемость важнее полноты —
 * вложенный разбор приносит с собой углы, в которых и живут дыры.
 */
export function parseMarkup(body: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;

  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(body);
  while (match !== null) {
    if (match.index > at) tokens.push({ kind: "text", text: body.slice(at, match.index) });

    const { token, tail } = tokenOf(match);
    tokens.push(token);
    if (tail) tokens.push({ kind: "text", text: tail });

    at = match.index + match[0].length;
    match = PATTERN.exec(body);
  }

  if (at < body.length) tokens.push({ kind: "text", text: body.slice(at) });
  return tokens;
}
