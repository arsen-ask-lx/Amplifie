/**
 * Подсадки правила «не пусто вместо значения» (task-125).
 *
 * ⚠️ ФОРМЫ — ИЗ НАСТОЯЩИХ ТЕСТОВ ПРОЕКТА (ревизия 27.09): `expect(body.fields?.password)
 * .toBeTruthy()` в auth.e2e, `pinnedAt).toBeTruthy()` в sync-changes, сторож
 * `toBeDefined()` перед точной проверкой — законный.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { weakAsserts } from "./weak-asserts-rule.mjs";

const found = (text) => weakAsserts(text).map((one) => one.line);

describe("«не пусто» последней проверкой значения — находка", () => {
  for (const [name, code] of [
    ["toBeTruthy", `it("x", () => {\n  expect(body.fields?.password).toBeTruthy();\n});`],
    ["toBeDefined", `it("x", () => {\n  expect(edited).toBeDefined();\n});`],
    [
      "not.toBeNull",
      `it("x", () => {\n  expect(res.headers.get("retry-after")).not.toBeNull();\n});`,
    ],
    ["toBeFalsy", `it("x", () => {\n  expect(common).toBeFalsy();\n});`],
    ["not.toBeUndefined", `it("x", () => {\n  expect(row).not.toBeUndefined();\n});`],
  ]) {
    it(name, () => assert.deepEqual(found(code), [2]));
  }
});

describe("законные формы — не находка", () => {
  it("сторож перед точной проверкой того же значения", () => {
    const code = `it("x", () => {\n  expect(edited).toBeDefined();\n  expect(edited?.body).toBe("новое");\n});`;
    assert.deepEqual(found(code), []);
  });

  it("сторож с `!` перед точной проверкой", () => {
    const code = `it("x", () => {\n  expect(row).not.toBeNull();\n  expect(row!.seq).toBe(3);\n});`;
    assert.deepEqual(found(code), []);
  });

  it("сторож с сообщением вторым аргументом — значение то же", () => {
    const code = `it("x", () => {\n  expect(called, "виден").toBeDefined();\n  expect(called?.name).toBe("Анна");\n});`;
    assert.deepEqual(found(code), []);
  });

  it("точные проверки не трогаются: toBeNull, toBe(true), toEqual", () => {
    const code = `it("x", () => {\n  expect(a).toBeNull();\n  expect(b).toBe(true);\n  expect(c).toEqual([]);\n});`;
    assert.deepEqual(found(code), []);
  });
});

describe("граница теста", () => {
  it("точная проверка в СЛЕДУЮЩЕМ тесте сторожа не оправдывает", () => {
    const code = [
      `it("a", () => {`,
      `  expect(x).toBeDefined();`,
      `});`,
      `it("b", () => {`,
      `  expect(x.a).toBe(1);`,
      `});`,
    ].join("\n");
    assert.deepEqual(found(code), [2]);
  });

  it("похожее начало — не то же значение: `x` и `xy`", () => {
    const code = `it("x", () => {\n  expect(x).toBeTruthy();\n  expect(xy.a).toBe(1);\n});`;
    assert.deepEqual(found(code), [2]);
  });
});

/** Ревью шага 2: формы, которые построчный разбор пропускал или путал. */
describe("ревью: запись вызова", () => {
  const one = (body) => found(`it("x", () => {\n${body}\n});`);

  it("аргумент на нескольких строках — находка на строке вызова", () => {
    assert.deepEqual(one(`  expect(\n    body.fields?.password,\n  ).toBeTruthy();`), [2]);
  });
  it("цепочка перенесена на следующую строку", () => {
    assert.deepEqual(one(`  expect(x)\n    .toBeTruthy();`), [2]);
  });
  it("expect.soft и resolves", () => {
    assert.deepEqual(
      one(`  expect.soft(a).toBeTruthy();\n  await expect(p).resolves.toBeDefined();`),
      [2, 3],
    );
  });
  it("слабые в другой записи: not.toBe(null), not.toBe(undefined), not.toHaveLength(0)", () => {
    const body = `  expect(a).not.toBe(null);\n  expect(b).not.toBe(undefined);\n  expect(c).not.toHaveLength(0);`;
    assert.deepEqual(one(body), [2, 3, 4]);
  });
  it("скобка внутри строки аргумента не рвёт вызов", () => {
    assert.deepEqual(one(`  expect(f(")")).toBeTruthy();`), [2]);
  });
  it("комментарий и строки с образцами — не код", () => {
    assert.deepEqual(
      one("  // expect(a).toBeTruthy();\n  const s = `expect(b).toBeTruthy()`;"),
      [],
    );
  });
  it("чужое слово с expect в конце — не вызов", () => {
    assert.deepEqual(one("  myexpect(a).toBeTruthy();\n  foo.expect(b).toBeTruthy();"), []);
  });
});

describe("ревью: что оправдывает сторожа", () => {
  const one = (body) => found(`it("x", () => {\n${body}\n});`);

  it("точная проверка в той же строке оправдывает", () => {
    assert.deepEqual(one("  expect(x).toBeDefined(); expect(x.a).toBe(1);"), []);
  });
  it("отрицание и «больше нуля» — не точная проверка", () => {
    const body = `  expect(x).toBeDefined();\n  expect(x).not.toBe(5);\n  expect(y).toBeDefined();\n  expect(y.length).toBeGreaterThan(0);`;
    assert.deepEqual(one(body), [2, 4]);
  });
  it('`!` внутри строки не снимается: t("hi!") — не t("hi")', () => {
    assert.deepEqual(one(`  expect(t("hi")).toBeDefined();\n  expect(t("hi!").a).toBe(1);`), [2]);
  });
});

describe("ревью: граница теста", () => {
  it("describe и beforeAll закрывают тест", () => {
    const code = [
      `it("a", () => {`,
      `  expect(x).toBeDefined();`,
      `});`,
      `describe("b", () => {`,
      `  beforeAll(() => { expect(x.a).toBe(1); });`,
      `});`,
    ].join("\n");
    assert.deepEqual(found(code), [2]);
  });
  it("помощник ниже последнего теста сторожа не оправдывает", () => {
    const code = `it("a", () => {\n  expect(x).toBeDefined();\n});\nfunction check() {\n  expect(x.a).toBe(1);\n}`;
    assert.deepEqual(found(code), [2]);
  });
  it("вложенная функция внутри теста его не закрывает (третий круг ревью)", () => {
    const code = `it("x", () => {\n  expect(x).toBeDefined();\n  function helper() { return 1; }\n  expect(x.a).toBe(1);\n});`;
    assert.deepEqual(found(code), []);
  });
  it("стрелочный помощник ниже последнего теста сторожа не оправдывает", () => {
    const code = `it("a", () => {\n  expect(x).toBeDefined();\n});\nconst sure = (r) => {\n  expect(x.a).toBe(1);\n};`;
    assert.deepEqual(found(code), [2]);
  });
  it("комментарий между вызовом и цепочкой не прячет проверку", () => {
    const code = `it("x", () => {\n  expect(a)\n    // пояснение\n    .toBeTruthy();\n});`;
    assert.deepEqual(found(code), [2]);
  });
  it("«не пусто» в помощнике — находка (В-2: правило видит помощник в своём файле)", () => {
    const code = `function sure(r) {\n  expect(r.id).toBeTruthy();\n}\nit("a", () => sure(x));`;
    assert.deepEqual(found(code), [2]);
  });
});

describe("что отдаёт правило", () => {
  it("номер строки и сам вызов — ключ храповика", () => {
    const [one] = weakAsserts(`it("x", () => {\n    expect(ok).toBeTruthy();\n});`);
    assert.deepEqual(one, { line: 2, text: "expect(ok).toBeTruthy()" });
  });

  it("многострочный вызов — в одну строку, пробелы сжаты", () => {
    const [one] = weakAsserts(
      `it("x", () => {\n  expect(\n    a.b,\n    "есть",\n  ).toBeTruthy();\n});`,
    );
    assert.deepEqual(one, { line: 2, text: 'expect( a.b, "есть", ).toBeTruthy()' });
  });
});
