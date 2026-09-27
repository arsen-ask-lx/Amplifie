/**
 * Разбор вывода git для гейтов цикла и карты — один на оба.
 *
 * ⚠️ ТОЛЬКО `-z`. Без него git печатает имя в кавычках с экранированием, если в
 * нём не-ASCII (при `core.quotePath=true` — так в Linux по умолчанию), кавычка,
 * табуляция или перевод строки. 27.09 из-за этого сторож цикла не нашёл планы
 * с русскими именами и краснил CI, а сторож карты молча видел на повод меньше.
 * С `-z` имена идут как есть, разделитель — нулевой байт (git-diff(1), «-z»).
 */

/** Ключи вывода изменений: к `diff`/`diff-tree` вместе с `--name-status`. */
export const NAME_STATUS = ["--name-status", "-z"];

/**
 * `--name-status -z`: статус, NUL, путь, NUL; у переименования и копии (`R100`,
 * `C75`) — два пути, берётся новый: важно, где файл лежит СЕЙЧАС.
 */
export function parseChanges(raw) {
  const parts = raw.split("\0");
  const changes = [];
  for (let at = 0; at < parts.length && parts[at]; ) {
    const status = parts[at][0];
    const paired = status === "R" || status === "C";
    const path = parts[at + (paired ? 2 : 1)];
    if (path) changes.push({ status, path });
    at += paired ? 3 : 2;
  }
  return changes;
}

/** Список путей `ls-files -z` / `ls-tree -r --name-only -z`. */
export function parsePaths(raw) {
  return raw.split("\0").filter(Boolean);
}
