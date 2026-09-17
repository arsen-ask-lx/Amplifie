import { searchFold } from "@amplifie/contract";
import { parseMarkup, plain, type Token } from "./markup.js";

/**
 * Строка найденного сообщения (task-100): тело → одна строка → кусок вокруг
 * совпадения → куски «подсветить / нет».
 *
 * ⚠️ ТОТ ЖЕ РАЗБОР РАЗМЕТКИ, ЧТО У ЛЕНТЫ, А НЕ СВОЯ ЧИСТКА. Строка выдачи
 * обязана выглядеть как то же сообщение в чате: упоминание — «@Анна», ссылка —
 * подписью. Своя регулярка рядом с `markup.ts` разошлась бы с ним на первой
 * новой разметке.
 *
 * ⚠️ ПОДСВЕТКА ПО НАЧАЛУ СЛОВА — ЧЕСТНЫЙ ПРЕДЕЛ, А НЕ НЕДОДЕЛКА. Сервер находит
 * и по основе («договором» → «договоры»), но основу знает только Postgres.
 * Такая реплика найдена и показана — просто без подсветки (план task-100).
 */

/** Кусок строки выдачи. */
export interface Mark {
  text: string;
  hit: boolean;
}

/** Текст куска как его видит человек: упоминание — с собакой. */
function shown(token: Token): string {
  if (token.kind === "mention") return `@${token.text}`;
  if ("children" in token) return token.children.map(shown).join("");
  return plain(token);
}

/** Тело сообщения → одна строка без разметки. */
export function lineOf(body: string): string {
  return parseMarkup(body).map(shown).join("").replace(/\s+/gu, " ").trim();
}

/** Где в строке первое слово запроса, начинающее слово строки; нет — `-1`. */
function firstHit(folded: string, words: string[]): number {
  // Тот же проход, что у подсветки: первый подсвеченный кусок и есть совпадение.
  let at = 0;
  for (const mark of marksIn(folded, words)) {
    if (mark.hit) return at;
    at += mark.text.length;
  }
  return -1;
}

/** Слово строки начинается здесь: слева не буква и не цифра. */
function startsWord(text: string, at: number): boolean {
  return at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1] ?? "");
}

/**
 * Кусок строки длиной до `width`, в котором видно первое совпадение.
 * Обрезанные края — многоточием.
 */
export function snippetAround(line: string, words: string[], width: number): string {
  if (line.length <= width) return line;
  const hit = Math.max(0, firstHit(searchFold(line), words));
  const from = Math.max(0, Math.min(hit - Math.floor(width / 3), line.length - width));
  const to = from + width;
  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
}

/**
 * Строка → куски «подсветить / нет»: совпадение слова запроса с началом
 * слова строки, без учёта регистра и ё. Куски складываются обратно
 * в исходную строку — нормализация длину не меняет (`searchFold`).
 */
export function marksIn(text: string, words: string[]): Mark[] {
  const folded = searchFold(text);
  const marks: Mark[] = [];
  let plainFrom = 0;
  let at = 0;
  while (at < text.length) {
    const word = startsWord(folded, at)
      ? words.find((one) => folded.startsWith(one, at))
      : undefined;
    if (!word) {
      at += 1;
      continue;
    }
    if (at > plainFrom) marks.push({ text: text.slice(plainFrom, at), hit: false });
    marks.push({ text: text.slice(at, at + word.length), hit: true });
    at += word.length;
    plainFrom = at;
  }
  if (plainFrom < text.length || marks.length === 0) {
    marks.push({ text: text.slice(plainFrom), hit: false });
  }
  return marks;
}
