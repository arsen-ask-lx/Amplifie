#!/usr/bin/env node
/** Каждое решение единого реестра имеет собственные основания и постоянный номер. */
import { existsSync, readFileSync } from "node:fs";

const FILE = "dock/decisions.md";
if (!existsSync(FILE)) {
  console.error(`${FILE}: реестр отсутствует; восстанови файл, пустота не является успехом`);
  process.exit(1);
}
const text = readFileSync(FILE, "utf8");
const markers = [...text.matchAll(/^<a id="r-(\d{3})"><\/a>\s*$/gmu)];
const problems = [];
const seen = new Set();
if (!markers.length) problems.push("нет ни одного решения с якорем r-NNN");
for (const [index, marker] of markers.entries()) {
  const number = marker[1];
  if (seen.has(number)) problems.push(`Р-${number}: номер занят дважды`);
  seen.add(number);
  const body = text.slice(marker.index, markers[index + 1]?.index).split("</details>")[0];
  if (!new RegExp(`^### Р-${number}(?:\\s|$)`, "mu").test(body)) {
    problems.push(`Р-${number}: якорь не соответствует заголовку ### Р-${number}`);
  }
  const sources = /^#{1,6}\s+(?:источники|sources)(?:\s|$).*$/imu.exec(body);
  if (!sources) {
    problems.push(`Р-${number}: нет собственного раздела «Источники»`);
    continue;
  }
  const sourceText = body.slice(sources.index).split("</details>")[0];
  const links = new Set(
    [...sourceText.matchAll(/\]\((https?:\/\/[^)]+)\)/gu)]
      .map((match) => match[1])
      .filter((url) => !/^https?:\/\/(?:localhost(?:[:/]|$)|127\.|\[::1\])/iu.test(url)),
  );
  if (links.size < 2)
    problems.push(`Р-${number}: внешних источников ${links.size}, нужно минимум 2`);
}
for (const problem of problems) console.error(`${FILE}: ${problem}`);
console.log(`решения: ${markers.length}, ошибок: ${problems.length}`);
if (problems.length) process.exitCode = 1;
