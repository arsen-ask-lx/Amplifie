/**
 * Проверки правила «план, тест, спека, ревью — строками в коммите» (task-116).
 *
 * ⚠️ ЭТО И ЕСТЬ ПОДСАЖЕННЫЕ НАРУШЕНИЯ. Гейт, который ни разу не краснел,
 * неотличим от молчащего. Два случая ниже — не выдуманные: это составы
 * настоящих коммитов 26.09, сделанных без плана (Р-045 и Р-044). Правило,
 * которое их пропускает, не ловит ровно то, на что жаловался владелец.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { kindOf, messageOf, verdict } from "./cycle-rule.mjs";

const M = (path) => ({ status: "M", path });
const A = (path) => ({ status: "A", path });

/** Планы, которые «лежат в git» у подсадок. */
const PLANS = {
  116: { path: "dock/tasks/task-116-цикл.md", status: "одобрен" },
  117: { path: "dock/tasks/task-117-переслать.md", status: "черновик" },
  "001": { path: "dock/tasks/task-001-мост.md", status: "сделано" },
};
const planOf = (number) => PLANS[number] ?? null;

const FULL = [
  "fix(поле): текст не теряется",
  "",
  "план: task-116",
  "тест: frontend/tests/ui/typing.spec.ts",
  "спека: 2026-09-26-typing",
  "ревью: ocr — замечаний 2, принято 1",
].join("\n");

const check = (changes, message = FULL) => verdict({ changes, message, parents: 1 }, planOf);
const missing = (got) => got.problems.map((one) => one.step).sort();

describe("какой файл что требует", () => {
  it("продукт, поставка, прочее", () => {
    assert.equal(kindOf("frontend/src/app/App.tsx"), "product");
    assert.equal(kindOf("backend/src/kernel/talk/repo.ts"), "product");
    assert.equal(kindOf("backend/migrations/0030_x.sql"), "product");
    assert.equal(kindOf("packages/contract/src/api.ts"), "product");
    assert.equal(kindOf("bridge/src/main.ts"), "product");
    assert.equal(kindOf("tools/checks/check-arch.mjs"), "delivery");
    assert.equal(kindOf("frontend/Dockerfile"), "delivery");
    assert.equal(kindOf("frontend/Caddyfile"), "delivery");
    assert.equal(kindOf("compose.yml"), "delivery");
    assert.equal(kindOf(".githooks/commit-msg"), "delivery");
    assert.equal(kindOf("frontend/src/data/feed.test.ts"), "other");
    assert.equal(kindOf("frontend/tests/ui/typing.spec.ts"), "other");
    assert.equal(kindOf("tools/checks/arch-rules.test.mjs"), "other");
    assert.equal(kindOf("tools/gates/dead-code/red/x.ts"), "other");
    assert.equal(kindOf("tools/gates/dead-code/green/x.ts"), "other");
    // Сам гейт — оснастка: его ослабление без ревью и есть то, что ловим.
    assert.equal(kindOf("tools/gates/dead-code/check.sh"), "delivery");
    assert.equal(kindOf("dock/debt.md"), "other");
    assert.equal(kindOf("package-lock.json"), "other");
  });
});

describe("настоящие коммиты 26.09 без плана — красные", () => {
  it("8feb996, Р-045: десять продуктовых файлов, план не назван", () => {
    const changes = [
      M("backend/src/kernel/talk/index.ts"),
      M("backend/src/kernel/talk/repo.ts"),
      M("backend/src/kernel/talk/service.ts"),
      M("backend/src/surface/http/failures.ts"),
      M("backend/src/surface/http/limits.ts"),
      M("backend/src/surface/http/routes/chat.ts"),
      A("backend/tests/pins.e2e.test.ts"),
      M("dock/README.md"),
      M("frontend/src/data/feedState.ts"),
      M("frontend/src/data/useMessageActions.ts"),
      M("frontend/src/shared/trouble.ts"),
      M("frontend/src/styles.css"),
      A("frontend/tests/ui/pin-limit.spec.ts"),
    ];
    const message = "feat(закреплённое): до ста на чат (Р-045)\n\nСделано: …";
    const got = check(changes, message);
    assert.equal(got.ok, false);
    assert.deepEqual(missing(got), ["план", "ревью", "спека"]);
  });

  it("b26fb6e, Р-044: даже с отказом «не требуется» — feat требует плана", () => {
    const changes = [
      M("frontend/src/app/ChannelRow.tsx"),
      M("frontend/src/app/ProjectRow.tsx"),
      A("frontend/src/app/RowStatus.tsx"),
      M("frontend/tests/ui/row-menu.spec.ts"),
    ];
    const message = [
      "feat(панель): состояние чата значком (Р-044)",
      "план: не требуется — небольшая правка вида",
      "спека: не требуется — это только вид строки",
      "ревью: не требуется — правка маленькая",
    ].join("\n");
    const got = check(changes, message);
    assert.equal(got.ok, false);
    assert.deepEqual(missing(got), ["план"]);
    assert.match(got.problems[0].why, /feat/u);
  });
});

describe("все четыре строки — проходит", () => {
  it("полный набор", () => {
    const got = check([
      M("frontend/src/app/App.tsx"),
      M("frontend/tests/ui/typing.spec.ts"),
      M("openspec/changes/2026-09-26-typing/proposal.md"),
    ]);
    assert.deepEqual(got.problems, []);
    assert.equal(got.ok, true);
  });

  it("регистр букв не важен, и отказы с причиной годятся ниже порога", () => {
    const message = [
      "fix(поле): опечатка в подсказке",
      "План: не требуется — одна строка подсказки",
      "Тест: не требуется — текст подсказки не поведение",
      "Спека: не требуется — поведение не меняется",
      "Ревью: ocr — замечаний 0, принято 0",
    ].join("\n");
    assert.equal(check([M("frontend/src/app/App.tsx")], message).ok, true);
  });

  it("строки после черты `>8` (git commit -v) не читаются", () => {
    const message = [
      "fix(поле): правка",
      "# ------------------------ >8 ------------------------",
      "план: task-116",
      "тест: не требуется — только проверка черты",
      "спека: не требуется — только проверка черты",
      "ревью: ocr — замечаний 0, принято 0",
    ].join("\n");
    assert.equal(messageOf(message).includes("task-116"), false);
    assert.equal(check([M("frontend/src/app/App.tsx")], message).ok, false);
  });
});

describe("план", () => {
  const rest = [
    "тест: не требуется — подсадка про план",
    "спека: не требуется — подсадка про план",
    "ревью: ocr — замечаний 0, принято 0",
  ];
  const withPlan = (line, subject = "fix(x): правка") => [subject, line, ...rest].join("\n");

  it("упоминание task-NNN в тексте — не план", () => {
    const got = check([M("frontend/src/app/App.tsx")], withPlan("не как в task-116"));
    assert.deepEqual(missing(got), ["план"]);
  });

  it("план-черновик — не план", () => {
    const got = check([M("frontend/src/app/App.tsx")], withPlan("план: task-117"));
    assert.deepEqual(missing(got), ["план"]);
    assert.match(got.problems[0].why, /черновик/u);
  });

  it("сделанный давно план — не план этого коммита", () => {
    const got = check([M("frontend/src/app/App.tsx")], withPlan("план: task-001"));
    assert.deepEqual(missing(got), ["план"]);
  });

  it("сделанный план годится, если правится этим же коммитом", () => {
    const got = check(
      [M("frontend/src/app/App.tsx"), M("dock/tasks/task-001-мост.md")],
      withPlan("план: task-001"),
    );
    assert.equal(got.ok, true);
  });

  it("плана нет в git — не план", () => {
    const got = check([M("frontend/src/app/App.tsx")], withPlan("план: task-999"));
    assert.deepEqual(missing(got), ["план"]);
  });

  it("причина короче десяти знаков — не отказ", () => {
    const got = check([M("frontend/src/app/App.tsx")], withPlan("план: не требуется — да"));
    assert.deepEqual(missing(got), ["план"]);
  });

  const refused = "план: не требуется — это совсем мелкая правка";
  for (const [name, changes] of [
    ["миграция", [A("backend/migrations/0031_x.sql")]],
    ["общий договор", [M("packages/contract/src/api.ts")]],
    ["новая дверь", [A("backend/src/surface/http/routes/files.ts")]],
    [
      "шесть продуктовых файлов",
      ["a", "b", "c", "d", "e", "f"].map((n) => M(`frontend/src/${n}.ts`)),
    ],
  ]) {
    it(`отказ запрещён: ${name}`, () => {
      const got = check(changes, withPlan(refused));
      assert.equal(
        got.problems.some((one) => one.step === "план"),
        true,
      );
    });
  }

  it("правка существующей двери — отказ допустим", () => {
    const got = check([M("backend/src/surface/http/routes/chat.ts")], withPlan(refused));
    assert.equal(
      got.problems.some((one) => one.step === "план"),
      false,
    );
  });
});

describe("тест", () => {
  const lines = (test) =>
    [
      "fix(x): правка",
      "план: task-116",
      test,
      "спека: не требуется — подсадка про тест",
      "ревью: ocr — замечаний 0, принято 0",
    ].join("\n");

  it("тест своей стороны засчитан", () => {
    for (const [code, test] of [
      ["frontend/src/app/App.tsx", "frontend/tests/ui/a.spec.ts"],
      ["frontend/src/app/App.tsx", "frontend/src/app/App.test.tsx"],
      ["backend/src/kernel/talk/repo.ts", "backend/tests/a.e2e.test.ts"],
      ["backend/migrations/0031_x.sql", "backend/tests/a.e2e.test.ts"],
      ["bridge/src/main.ts", "bridge/src/main.test.ts"],
      ["packages/contract/src/api.ts", "packages/contract/src/api.test.ts"],
    ]) {
      const got = check([M(code), M(test)], lines("тест: есть"));
      assert.equal(
        got.problems.some((one) => one.step === "тест"),
        false,
        `${code} + ${test}`,
      );
    }
  });

  it("тест чужой стороны — не тест этой правки", () => {
    const got = check(
      [M("frontend/src/app/App.tsx"), M("backend/tests/a.e2e.test.ts")],
      lines("тест: есть"),
    );
    assert.deepEqual(missing(got), ["тест"]);
  });

  it("правка двух сторон требует теста каждой", () => {
    const got = check(
      [
        M("frontend/src/app/App.tsx"),
        M("backend/src/kernel/talk/repo.ts"),
        M("backend/tests/a.e2e.test.ts"),
      ],
      lines("тест: есть"),
    );
    assert.deepEqual(missing(got), ["тест"]);
  });

  it("без теста — только отказ с причиной", () => {
    const ok = check([M("frontend/src/app/App.tsx")], lines("тест: не требуется — перенос строки"));
    assert.equal(ok.ok, true);
  });
});

describe("спека", () => {
  const lines = (spec) =>
    [
      "fix(x): правка",
      "план: task-116",
      "тест: не требуется — подсадка про спеку",
      spec,
      "ревью: ocr — замечаний 0, принято 0",
    ].join("\n");

  it("id изменения, тронутого коммитом", () => {
    const got = check(
      [M("frontend/src/app/App.tsx"), A("openspec/changes/archive/2026-09-26-typing/tasks.md")],
      lines("спека: 2026-09-26-typing"),
    );
    assert.equal(got.ok, true);
  });

  it("чужое изменение в openspec — не спека этой правки", () => {
    const got = check(
      [M("frontend/src/app/App.tsx"), M("openspec/changes/2026-09-11-panel-pages/tasks.md")],
      lines("спека: 2026-09-26-typing"),
    );
    assert.deepEqual(missing(got), ["спека"]);
  });
});

describe("ревью", () => {
  it("«ревью: ок» — не след", () => {
    const got = check([M("tools/checks/check-arch.mjs")], "fix(оснастка): правка\nревью: ок");
    assert.deepEqual(missing(got), ["ревью"]);
  });

  it("оснастке нужно только ревью", () => {
    const got = check(
      [M("tools/checks/check-arch.mjs")],
      "fix(оснастка): правка\nревью: ocr — замечаний 3, принято 2",
    );
    assert.equal(got.ok, true);
  });

  it("правка оснастки без ревью — отказ (так ушёл сторож Р-047)", () => {
    const got = check([A("tools/checks/arch-rules.mjs")], "feat(оснастка): сторож");
    assert.deepEqual(missing(got), ["ревью"]);
  });
});

describe("что не проверяется", () => {
  it("только документы и тесты", () => {
    const got = check([M("dock/debt.md"), M("frontend/tests/ui/a.spec.ts")], "docs: ход");
    assert.equal(got.ok, true);
    assert.equal(got.needed, false);
  });

  it("отмена — по строке git, а не по слову в теме", () => {
    const revert = check(
      [M("frontend/src/app/App.tsx")],
      'Revert "fix(x): правка"\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.',
    );
    assert.equal(revert.ok, true);
    const fake = check([M("frontend/src/app/App.tsx")], "Revert отступ и добавить значок");
    assert.equal(fake.ok, false);
  });

  it("слияние само не проверяется — проверяется его второй родитель", () => {
    const merge = verdict(
      { changes: [M("frontend/src/app/App.tsx")], message: "Merge branch x", parents: 2 },
      planOf,
    );
    assert.equal(merge.ok, true);
    assert.equal(merge.needed, false);
  });
});
