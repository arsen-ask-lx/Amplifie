/**
 * Проверки счётчика согласия. Числа посчитаны РУКАМИ и записаны в тесте
 * вместе с выкладкой: если прибор врёт, врать будет и всё, что он измерит.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cohenKappa, scoreAgainst } from "./kappa.mjs";

const yes = "agreement";
const no = "chatter";
const pair = (a, b, times) => Array.from({ length: times }, () => ({ a, b }));

/**
 * Сравнение с допуском. Округлять внутри прибора нельзя — округление теряет
 * то, что он меряет. Значит допуск живёт здесь: 0.4 в двоичной дроби
 * не представимо, и 0.3999999999999999 — верный ответ, а не ошибка.
 */
function close(actual, expected, what) {
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) < 1e-12,
    `${what}: ожидалось ${expected}, получено ${actual}`,
  );
}

test("каппа считается по формуле, а не по доле совпадений", () => {
  // 4 «оба да», 3 «оба нет», 2 «а да / б нет», 1 «а нет / б да» — всего 10.
  // po = 7/10 = 0.7
  // «да» у а = 6/10 = 0.6, у б = 5/10 = 0.5
  // pe = 0.6·0.5 + 0.4·0.5 = 0.5
  // κ  = (0.7 − 0.5) / (1 − 0.5) = 0.4
  const rows = [...pair(yes, yes, 4), ...pair(no, no, 3), ...pair(yes, no, 2), ...pair(no, yes, 1)];
  close(cohenKappa(rows), 0.4, "каппа");
});

test("полное согласие при обоих классах даёт единицу", () => {
  close(cohenKappa([...pair(yes, yes, 5), ...pair(no, no, 5)]), 1, "полное согласие");
});

test("корпус из одного класса НЕ даёт каппу — прибор обязан отказаться", () => {
  // po = 1 и pe = 1, формула даёт 0/0. Вернуть здесь единицу — соврать:
  // корпус, где все ответы одинаковы, не различает ничего.
  assert.equal(cohenKappa(pair(yes, yes, 10)), null);
});

test("случайное совпадение вычитается: κ = 0 при независимых разметках", () => {
  // а: да в половине, б: да в половине, и совпадения ровно случайные.
  const rows = [
    ...pair(yes, yes, 25),
    ...pair(yes, no, 25),
    ...pair(no, yes, 25),
    ...pair(no, no, 25),
  ];
  close(cohenKappa(rows), 0, "независимые разметки");
});

test("пустой корпус — тоже отказ, а не ноль", () => {
  assert.equal(cohenKappa([]), null);
});

test("точность и полнота считаются только по бесспорному", () => {
  // Три бесспорных «договорённость», одно бесспорное «болтовня», одно спорное.
  const rows = [
    { a: yes, b: yes, agent: yes },
    { a: yes, b: yes, agent: yes },
    { a: yes, b: yes, agent: no }, // пропуск
    { a: no, b: no, agent: yes }, // выдумка
    { a: yes, b: no, agent: yes }, // спорное — не считается вовсе
  ];
  const got = scoreAgainst(rows);
  assert.equal(got.counted, 4);
  assert.equal(got.disputed, 1);
  // нашёл 2 настоящих, выдумал 1 → точность 2/3
  close(got.precision, 2 / 3, "точность");
  // настоящих было 3, нашёл 2 → полнота 2/3
  close(got.recall, 2 / 3, "полнота");
});

test("агент без единого «да» не получает точность 1 — она не определена", () => {
  const rows = [
    { a: yes, b: yes, agent: no },
    { a: no, b: no, agent: no },
  ];
  const got = scoreAgainst(rows);
  assert.equal(got.precision, null);
  assert.equal(got.recall, 0);
});
