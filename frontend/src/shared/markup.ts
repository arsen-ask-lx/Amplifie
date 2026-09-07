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
 * ПОДМНОЖЕСТВО НАМЕРЕННО УЗКОЕ: жирный, курсив, код, ссылка. Расширять
 * можно — сужать нельзя, потому что накопленные сообщения перестанут
 * выглядеть так, как их писали.
 */

export type Token =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
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
 * `_курсив_` намеренно НЕ поддержан: он рвёт `имя_переменной` и пути,
 * которых в рабочей переписке больше, чем курсива.
 */
const PATTERN = new RegExp(
  [
    "`([^`\\n]+)`", // код
    "\\*\\*([^*\\n]+)\\*\\*", // жирный
    "\\*([^*\\n]+)\\*", // курсив
    "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)", // ссылка с подписью
    "(https?://[^\\s<>()]+)", // голый адрес
  ].join("|"),
  "gu",
);

/** Хвостовая пунктуация к адресу не относится: «см. http://a.b.» */
const TRAILING = /[.,!?;:»"']+$/u;

function linkToken(text: string, rawHref: string): Token {
  const href = safeHref(rawHref);
  // Негодная схема — показываем подпись обычным текстом. Не выбрасываем:
  // человек написал это и должен увидеть, что именно он написал.
  return href ? { kind: "link", text, href } : { kind: "text", text };
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

/** Один найденный кусок → токен плюс возможный хвост после него. */
function tokenOf(match: RegExpExecArray): { token: Token; tail: string } {
  const [, code, bold, italic, linkText, linkHref, bare] = match;
  if (code !== undefined) return { token: { kind: "code", text: code }, tail: "" };
  if (bold !== undefined) return { token: { kind: "bold", text: bold }, tail: "" };
  if (italic !== undefined) return { token: { kind: "italic", text: italic }, tail: "" };
  if (linkText !== undefined && linkHref !== undefined) {
    return { token: linkToken(linkText, linkHref), tail: "" };
  }
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
