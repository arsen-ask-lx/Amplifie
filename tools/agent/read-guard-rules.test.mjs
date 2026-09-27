/**
 * Проверки правил хука «правка — только после чтения целиком» (task-124).
 *
 * ⚠️ ФОРМА ВХОДА — НАСТОЯЩАЯ. Числа `startLine`, `numLines`, `totalLines` сняты
 * записывающим хуком с живых вызовов Read 27.09 (целиком, куском, повтор, подагент).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BIG_DOC_LINES,
  changedSince,
  decideEdit,
  decideShell,
  isFormatter,
  parseStatus,
  readSpan,
  relPath,
  sectionAround,
  stateOf,
} from "./read-guard-rules.mjs";

const read = (path, from, to, total, stamp = 1) => ({
  t: "read",
  path,
  from,
  to,
  total,
  size: stamp,
  mtime: stamp,
});
const own = (path, stamp = 1, created = false) => ({
  t: "own",
  path,
  created,
  size: stamp,
  mtime: stamp,
});
const text = (count) => Array.from({ length: count }, (_, n) => `строка ${n + 1}`).join("\n");
const file = (count, stamp = 1) => ({ size: stamp, mtime: stamp, text: text(count) });

function edit(events, path, disk, input = { old_string: "строка 5", new_string: "x" }) {
  return decideEdit({ tool: "Edit", path, input, file: disk, entry: stateOf(events).get(path) });
}

describe("правка после чтения", () => {
  it("новый файл — можно: читать нечего", () => {
    assert.equal(edit([], "a.ts", null).allow, true);
  });

  it("прочитан кусок — отказ с числом прочитанных строк", () => {
    const got = edit([read("a.ts", 1, 20, 370)], "a.ts", file(370));
    assert.equal(got.allow, false);
    assert.match(got.reason, /20 из 370/u);
  });

  it("прочитан целиком одним Read — можно", () => {
    assert.equal(edit([read("a.ts", 1, 35, 35)], "a.ts", file(35)).allow, true);
  });

  it("прочитан двумя кусками подряд до конца — можно", () => {
    const events = [read("a.ts", 1, 2000, 2500), read("a.ts", 2001, 2500, 2500)];
    assert.equal(edit(events, "a.ts", file(2500)).allow, true);
  });

  it("вторая своя правка не требует перечитывания", () => {
    const events = [read("a.ts", 1, 35, 35), own("a.ts", 2)];
    assert.equal(edit(events, "a.ts", file(35, 2)).allow, true);
  });

  it("свой новый файл — известен", () => {
    assert.equal(edit([own("b.ts", 7, true)], "b.ts", file(10, 7)).allow, true);
  });

  it("своя правка не делает известным то, что не читал (второй разбор критика)", () => {
    const events = [read("a.ts", 1, 20, 370), own("a.ts", 2)];
    assert.equal(edit(events, "a.ts", file(370, 2)).allow, false);
  });

  it("файл изменён снаружи после чтения — отказ", () => {
    const got = edit([read("a.ts", 1, 35, 35)], "a.ts", file(35, 9));
    assert.equal(got.allow, false);
    assert.match(got.reason, /изменён снаружи/u);
  });

  it("куски разных версий файла не складываются", () => {
    const events = [read("a.ts", 1, 20, 40, 1), read("a.ts", 21, 40, 40, 2)];
    assert.equal(edit(events, "a.ts", file(40, 2)).allow, false);
  });

  it("Read считает пустую строку после последнего перевода — полнота по строкам с диска", () => {
    // Живой случай 27.09: файл в 63 строки, Read сказал totalLines 64, прочитано 1–63.
    const event = { ...read("a.md", 1, 63, 64), lines: 63 };
    assert.equal(stateOf([event]).get("a.md").known, true);
  });

  it("после сжатия контекста прочитанного нет", () => {
    const events = [read("a.ts", 1, 35, 35), { t: "reset" }];
    assert.equal(edit(events, "a.ts", file(35)).allow, false);
  });
});

describe("большой документ — по разделам", () => {
  const size = BIG_DOC_LINES + 200;
  const lines = text(size).split("\n");
  lines[99] = "## Раздел А";
  lines[199] = "## Раздел Б";
  const doc = { size: 1, mtime: 1, text: lines.join("\n") };
  const input = { old_string: "строка 150", new_string: "x" };

  it("раздел правки прочитан целиком — можно", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "dock/debt.md",
      input,
      file: doc,
      entry: stateOf([read("dock/debt.md", 100, 199, size)]).get("dock/debt.md"),
    });
    assert.equal(got.allow, true);
  });

  it("раздел прочитан наполовину — отказ с границами раздела", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "dock/debt.md",
      input,
      file: doc,
      entry: stateOf([read("dock/debt.md", 100, 150, size)]).get("dock/debt.md"),
    });
    assert.equal(got.allow, false);
    assert.match(got.reason, /100–199/u);
  });

  it("Write поверх большого документа — только целиком", () => {
    const got = decideEdit({
      tool: "Write",
      path: "dock/debt.md",
      input: { content: "x" },
      file: doc,
      entry: stateOf([read("dock/debt.md", 100, 199, size)]).get("dock/debt.md"),
    });
    assert.equal(got.allow, false);
  });

  it("код правило разделов не получает, даже длинный", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "big.ts",
      input,
      file: doc,
      entry: stateOf([read("big.ts", 100, 199, size)]).get("big.ts"),
    });
    assert.equal(got.allow, false);
  });

  it("границы раздела — от заголовка до следующего", () => {
    assert.deepEqual(sectionAround(lines, 150), [100, 199]);
    assert.deepEqual(sectionAround(lines, 5), [1, 99]);
  });

  it("поправил раздел — другой раздел по-прежнему требует чтения", () => {
    const events = [read("dock/debt.md", 100, 199, size), own("dock/debt.md", 2)];
    const got = decideEdit({
      tool: "Edit",
      path: "dock/debt.md",
      input: { old_string: "строка 250", new_string: "x" },
      file: { ...doc, size: 2, mtime: 2 },
      entry: stateOf(events).get("dock/debt.md"),
    });
    assert.equal(got.allow, false);
    assert.match(got.reason, /200–/u);
  });

  it("строка «# …» в блоке кода — не заголовок", () => {
    const withCode = [...lines];
    withCode[139] = "```bash";
    withCode[149] = "# комментарий в коде";
    withCode[159] = "```";
    assert.deepEqual(sectionAround(withCode, 155), [100, 199]);
  });

  it("многострочная замена через заголовок требует оба раздела", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "dock/debt.md",
      input: { old_string: "строка 199\n## Раздел Б\nстрока 201", new_string: "x" },
      file: doc,
      entry: stateOf([read("dock/debt.md", 100, 199, size)]).get("dock/debt.md"),
    });
    assert.equal(got.allow, false);
  });
});

describe("правка через оболочку", () => {
  const exists = (path) => ["a.ts", "dock/x.md"].includes(path);
  const known = (path) => path === "dock/x.md";

  for (const command of [
    "sed -i 's/a/b/' a.ts",
    "sed -i 's/a|b/c/' a.ts",
    "sed -i 's/a/b/;s/c/d/' a.ts",
    "sed -i.bak -e 's/a/b/' a.ts",
    "perl -pi -e 's/a/b/' a.ts",
    "echo x | tee a.ts",
    "Set-Content -Path a.ts -Value x",
    "cd dir && sed -i 's/a/b/' a.ts",
    // Одиночный `&` — тоже граница звена: за ним новая команда (итоговое ревью task-124).
    "true & sed -i 's/a/b/' a.ts",
    "sed -i --expression=s/a/b/ a.ts",
    "sed -i 's/a/b/' a.ts 2>&1",
    // Склеенные ключи и суффикс копии — тоже правка на месте (ревью, четвёртый круг).
    "sed -Ei 's/a/b/' a.ts",
    "sed -ni 's/a/b/p' a.ts",
    "sed -Ei.bak 's/a/b/' a.ts",
    "sed --in-place 's/a/b/' a.ts",
    "sed --in-place=.bak 's/a/b/' a.ts",
    // Скрипт, склеенный с ключом, — не цель; цель за ним (пятый круг).
    "sed -i -fs.sed a.ts",
    "sed -i -es/a/b/ a.ts",
    // `-ie` у GNU — `-i` с суффиксом копии «e», скрипт — следующим словом.
    "sed -ie 's/a/b/' a.ts",
  ]) {
    it(`отказ: ${command}`, () => {
      assert.equal(decideShell({ command, known, exists }).allow, false);
    });
  }

  for (const command of [
    "grep -rn sed -i a.ts",
    "sed -n '1,5p' a.ts",
    "sed -i 's/a/b/' dock/x.md",
    "tee tmp/новый.log",
    "git commit -m 'sed -i a.ts'",
    // Файл скрипта после `-f` читается, а не правится (итоговое ревью task-124).
    "sed -i -f a.ts dock/x.md",
    "sed -i --file a.ts dock/x.md",
    "sed -i 's/a/b/' dock/x.md &> tmp/x.log",
    // Без `-i` — не правка, даже если в склеенном значении есть буква i (пятый круг).
    "sed -E 's/a/b/' a.ts",
    "sed --posix -s -z 's/a/b/' a.ts",
    "sed -fs.sed dock/x.md a.ts",
    "sed -fscript.sed a.ts",
  ]) {
    it(`можно: ${command}`, () => {
      assert.equal(decideShell({ command, known, exists }).allow, true);
    });
  }

  it("форматтеры узнаются в любом звене", () => {
    assert.equal(isFormatter("make format"), true);
    assert.equal(isFormatter("npx biome check --write tools"), true);
    assert.equal(isFormatter("cd frontend && npx biome check --write ."), true);
    assert.equal(isFormatter("npx biome check tools"), false);
    assert.equal(isFormatter("grep -rn 'make format' Makefile"), false);
  });

  it("изменённое командой — тронутое не раньше её начала", () => {
    const after = new Map([
      ["a.ts", 5],
      ["b.ts", 10],
      ["c.ts", 12],
    ]);
    assert.deepEqual(changedSince(after, 10), ["b.ts", "c.ts"]);
  });
});

describe("ревью task-124: разбор git status и крайние файлы", () => {
  it("переименование — один путь, старый не режется как запись; удаление помечено", () => {
    const raw = ["R  новый.md", "старый.md", " M a.ts", " D b.ts", "?? c.ts", ""].join("\0");
    assert.deepEqual(parseStatus(raw), [
      { path: "новый.md", deleted: false },
      { path: "a.ts", deleted: false },
      { path: "b.ts", deleted: true },
      { path: "c.ts", deleted: false },
    ]);
  });

  it("пустой файл — читать нечего", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "empty.ts",
      input: { old_string: "", new_string: "x" },
      file: { size: 0, mtime: 1, text: "" },
      entry: undefined,
    });
    assert.equal(got.allow, true);
  });

  const size = BIG_DOC_LINES + 50;
  const crlf = Array.from({ length: size }, (_, n) => (n === 9 ? "## Р" : `строка ${n + 1}`)).join(
    "\r\n",
  );
  const doc = { size: 1, mtime: 1, text: crlf };
  const entry = stateOf([read("big.md", 10, size, size)]).get("big.md");

  it("переводы строк Windows — раздел находится", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "big.md",
      input: { old_string: "строка 20\nстрока 21", new_string: "x" },
      file: doc,
      entry,
    });
    assert.equal(got.allow, true);
  });

  it("заменяемый текст не найден — отказ, а не пропуск", () => {
    const got = decideEdit({
      tool: "Edit",
      path: "big.md",
      input: { old_string: "нет такого", new_string: "x" },
      file: doc,
      entry,
    });
    assert.equal(got.allow, false);
    assert.match(got.reason, /не нашёл/u);
  });
});

describe("что дал ответ Read", () => {
  it("обычный ответ — его строки", () => {
    const response = { type: "text", file: { startLine: 1, numLines: 20, totalLines: 370 } };
    assert.deepEqual(readSpan(response), { from: 1, to: 20, total: 370 });
  });

  it("«не менялся» — не чтение: текста в ответе нет (форма снята с записи 27.09)", () => {
    const response = { type: "file_unchanged", file: { filePath: "E:\\Amplifie\\a.mjs" } };
    assert.equal(readSpan(response), null);
  });

  it("неизвестный ответ — не чтение", () => {
    assert.equal(readSpan({ type: "image" }), null);
  });
});

describe("пути", () => {
  it("абсолютный путь Windows — от корня проекта", () => {
    assert.equal(relPath("E:\\Amplifie\\tools\\a.mjs", "E:\\Amplifie"), "tools/a.mjs");
    assert.equal(relPath("e:/amplifie/tools/a.mjs", "E:\\Amplifie"), "tools/a.mjs");
    assert.equal(relPath("./tools/a.mjs", "E:\\Amplifie"), "tools/a.mjs");
  });
});
