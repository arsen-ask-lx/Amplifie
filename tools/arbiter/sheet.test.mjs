import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSheet, renderSheet } from "./sheet.mjs";

const corpus = [
  { id: "c001", context: ["Кто заберёт?"], utterance: "Я заберу.", a: "agreement" },
  { id: "c002", context: [], utterance: "Доброе утро", a: "chatter" },
];

test("лист не показывает первую разметку — иначе вторая не независимая", () => {
  const sheet = renderSheet(corpus);
  assert.ok(sheet.includes("Я заберу."), "реплика обязана быть видна");
  assert.ok(!sheet.includes("agreement"), "чужой ответ виден быть НЕ должен");
  assert.ok(!sheet.includes("chatter"), "чужой ответ виден быть НЕ должен");
});

test("обе раскладки и разные написания понимаются", () => {
  const { answers, broken } = parseSheet("c001 = д\nc002 = n\nc003 = Да\nc004 = НЕТ");
  assert.deepEqual(answers, {
    c001: "agreement",
    c002: "chatter",
    c003: "agreement",
    c004: "chatter",
  });
  assert.deepEqual(broken, []);
});

test("неотвеченное не считается ответом", () => {
  const { answers } = parseSheet("c001 = ?\nc002 =\nc003 = д");
  assert.deepEqual(answers, { c003: "agreement" });
});

test("опечатка НЕ проглатывается: она уменьшила бы выборку молча", () => {
  const { answers, broken } = parseSheet("c001 = дп\nc002 = н");
  assert.deepEqual(answers, { c002: "chatter" });
  assert.equal(broken.length, 1);
  assert.equal(broken[0]?.line, 1);
});

test("уже данные ответы переживают перевыпуск листа", () => {
  const sheet = renderSheet(corpus, { c001: "agreement", c002: "chatter" });
  const { answers } = parseSheet(sheet);
  assert.deepEqual(answers, { c001: "agreement", c002: "chatter" });
});

test("пустой лист даёт пустые ответы, а не падение", () => {
  assert.deepEqual(parseSheet("").answers, {});
});
