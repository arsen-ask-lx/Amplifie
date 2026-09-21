/** Локальные ссылки документации: файл и раздел проверяются вместе. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const root = process.cwd();
const files = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${root.replaceAll("\\", "/")}`,
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(
    (file) =>
      file.endsWith(".md") && existsSync(file) && !/tools\/gates\/.*\/(red|green)\//u.test(file),
  );

function prose(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
      if (marker && (!fence || marker[0] === fence[0])) {
        fence = fence ? null : marker;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function anchors(text) {
  const found = new Set();
  const counts = new Map();
  for (const match of text.matchAll(/<(?:a|span)\s+(?:id|name)=["']([^"']+)["']/gu))
    found.add(match[1]);
  for (const match of prose(text).matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const slug = match[1]
      .trim()
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/<[^>]+>/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/gu, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    found.add(count ? `${slug}-${count}` : slug);
  }
  return found;
}

const problems = [];
const cache = new Map();
let links = 0;
for (const file of new Set(files)) {
  const text = prose(readFileSync(file, "utf8")).replace(/(`+)[^\n]*?\1/gu, (code) =>
    " ".repeat(code.length),
  );
  for (const match of text.matchAll(
    /\]\((<[^>]+>|[^\s()]+(?:\([^()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\)/gu,
  )) {
    const target = match[1].replace(/^<|>$/gu, "");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) continue;
    links++;
    const [path, fragment] = decodeURIComponent(target).split("#");
    const full = path ? resolve(dirname(file), path) : resolve(file);
    const line = text.slice(0, match.index).split("\n").length;
    if (!existsSync(full)) {
      problems.push(`${file}:${line} — нет файла: ${target}`);
    } else if (fragment && extname(full) === ".md") {
      if (!cache.has(full)) cache.set(full, anchors(readFileSync(full, "utf8")));
      if (!cache.get(full).has(fragment)) problems.push(`${file}:${line} — нет раздела: ${target}`);
    }
  }
}
for (const problem of problems) console.error(problem);
console.log(
  `docs: ${new Set(files).size} файлов, ${links} локальных ссылок, ${problems.length} ошибок`,
);
if (problems.length) process.exitCode = 1;
