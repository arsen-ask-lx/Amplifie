/**
 * Проверки правила «план не идёт владельцу без второго прохода» (task-109).
 *
 * ⚠️ ЭТО И ЕСТЬ ПОДСАЖЕННЫЕ НАРУШЕНИЯ, как у `map-rule.test.mjs`: правило
 * вынесено чистой функцией, чтобы красный случай стоил трёх строк и жил
 * в наборе постоянно.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reviewProblems } from "./plan-review-rule.mjs";

const exists = (path) => !path.includes("нет-такого");

const READ = [
  "### Прочитано",
  "",
  "| файл | строк | как |",
  "|---|---|---|",
  "| `tools/checks/check-proof.mjs` | 107 | целиком |",
].join("\n");

const OPTIONS = [
  "## 3. Варианты",
  "",
  "| вариант | за | против |",
  "|---|---|---|",
  "| А (берём) | дёшево | грубо |",
  "| Б | точно | дорого |",
].join("\n");

const REVIEW = [
  "## Разбор критика",
  "",
  "- `service.ts:905` — средний — файл перерос предел — принято, выносим в шаге 3",
  "- «окно 24 ч» — низкий — число взято с потолка — отвергнуто: нет данных лучше, порог пересмотра назван",
].join("\n");

/** Начало находки «без вердикта» — литералом, а не из правила: текст находки читает человек. */
const NO_VERDICT = "замечание без вердикта (принято / отвергнуто с причиной): ";

const plan = (status, ...parts) =>
  [`# task-120-x: что-то`, "", `Статус: ${status}`, "", ...parts].join("\n\n");

describe("какие планы проверяются", () => {
  it("черновик без разбора — можно: он ещё пишется", () => {
    assert.deepEqual(reviewProblems("task-120-x.md", plan("черновик 2026-09-21", READ)), []);
  });

  it("старый план до task-109 — история, не проверяется", () => {
    assert.deepEqual(reviewProblems("task-100-x.md", plan("сделано 2026-09-17")), []);
  });

  it("одобренный план со всеми тремя разделами — чист", () => {
    const text = plan("одобрено владельцем 2026-09-21", READ, OPTIONS, REVIEW);
    assert.deepEqual(reviewProblems("task-120-x.md", text, exists), []);
  });
});

describe("что ловит", () => {
  it("одобренный без разбора критика", () => {
    const found = reviewProblems(
      "task-120-x.md",
      plan("одобрено 2026-09-21", READ, OPTIONS),
      exists,
    );
    assert.deepEqual(found, ["нет раздела «Разбор критика»: план не прошёл второй проход"]);
  });

  it("замечание без вердикта", () => {
    const review = "## Разбор критика\n\n- `a.ts:1` — высокий — гонка при повторе";
    const found = reviewProblems("task-120-x.md", plan("одобрено", READ, OPTIONS, review), exists);
    assert.deepEqual(found, [`${NO_VERDICT}- \`a.ts:1\` — высокий — гонка при повторе`]);
  });

  it("«отвергнуто» без причины", () => {
    const review = "## Разбор критика\n\n- `a.ts:1` — высокий — гонка — отвергнуто";
    const found = reviewProblems("task-120-x.md", plan("одобрено", READ, OPTIONS, review), exists);
    assert.deepEqual(found, [`${NO_VERDICT}- \`a.ts:1\` — высокий — гонка — отвергнуто`]);
  });

  it("один вариант — это не выбор", () => {
    const one = "## Варианты\n\n| вариант | за | против |\n|---|---|---|\n| А | да | нет |";
    const found = reviewProblems("task-120-x.md", plan("одобрено", READ, one, REVIEW), exists);
    assert.deepEqual(found, ["в «Варианты» меньше двух строк: один вариант — это не выбор"]);
  });

  it("в «Прочитано» файл, которого нет", () => {
    const read = READ.replace("tools/checks/check-proof.mjs", "tools/нет-такого.mjs");
    const found = reviewProblems("task-120-x.md", plan("одобрено", read, OPTIONS, REVIEW), exists);
    assert.deepEqual(found, ["в «Прочитано» файл, которого нет: tools/нет-такого.mjs"]);
  });

  it("нет таблицы «Прочитано» вовсе", () => {
    const found = reviewProblems("task-120-x.md", plan("одобрено", OPTIONS, REVIEW), exists);
    assert.deepEqual(found, ["нет таблицы «Прочитано»: файл | строк | как (целиком / фрагмент)"]);
  });

  it("критик не нашёл ничего — так и пишется, это не пустой раздел", () => {
    const clean =
      "## Разбор критика\n\nЗамечаний нет — критик прочёл все файлы из «Прочитано» и «менять».";
    assert.deepEqual(
      reviewProblems("task-120-x.md", plan("одобрено", READ, OPTIONS, clean), exists),
      [],
    );
  });
});

describe("разбор критика task-109 (21.09)", () => {
  it("task-108 — тоже в новом порядке: план обещал пройти его первым", () => {
    const found = reviewProblems("task-108-x.md", plan("одобрено", READ, OPTIONS), exists);
    assert.deepEqual(found, ["нет раздела «Разбор критика»: план не прошёл второй проход"]);
  });

  it("«не принято» — не вердикт", () => {
    const review = "## Разбор критика\n\n- `a.ts:1` — высокий — гонка — не принято";
    const found = reviewProblems("task-120-x.md", plan("одобрено", READ, OPTIONS, review), exists);
    assert.deepEqual(found, [`${NO_VERDICT}- \`a.ts:1\` — высокий — гонка — не принято`]);
  });

  it("«Замечаний нет» не прячет пункты без вердикта ниже", () => {
    const review = "## Разбор критика\n\nЗамечаний нет.\n\n- `a.ts:1` — высокий — гонка";
    const found = reviewProblems("task-120-x.md", plan("одобрено", READ, OPTIONS, review), exists);
    assert.deepEqual(found, [`${NO_VERDICT}- \`a.ts:1\` — высокий — гонка`]);
  });
});
