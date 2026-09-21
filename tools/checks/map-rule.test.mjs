/**
 * Проверки правила «карта не отстаёт от коммита».
 *
 * ⚠️ ЭТО И ЕСТЬ ПОДСАЖЕННОЕ НАРУШЕНИЕ. Гейт, который ни разу не краснел,
 * неотличим от молчащего, а гонять настоящие коммиты ради проверки гейта
 * значит проверять git. Правило вынесено чистой функцией ровно затем,
 * чтобы красный случай стоил трёх строк и жил в наборе постоянно.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAP, needsMap, refusalIn, verdict } from "./map-rule.mjs";

const changed = (path) => ({ status: "M", path });
const added = (path) => ({ status: "A", path });
const commit = (changes, message = "feat(что-то): и так далее") => verdict({ changes, message });

describe("что заставляет карту устареть", () => {
  it("единые англоязычные пути решений и долга", () => {
    assert.equal(needsMap([changed("dock/decisions.md")]).length, 1);
    assert.equal(needsMap([changed("dock/debt.md")]).length, 1);
  });
  it("новое решение", () => {
    assert.equal(needsMap([added("dock/decisions.md")]).length, 1);
  });

  it("правка плана задачи — статус задачи живёт в карте", () => {
    assert.equal(needsMap([changed("dock/tasks/task-019-что-нибудь.md")]).length, 1);
  });

  it("реестр долга", () => {
    assert.equal(needsMap([changed("dock/debt.md")]).length, 1);
  });

  it("миграция", () => {
    assert.equal(needsMap([added("backend/migrations/0016_что_нибудь.sql")]).length, 1);
  });

  it("новая дверь наружу", () => {
    assert.equal(needsMap([added("backend/src/surface/http/routes/files.ts")]).length, 1);
  });

  it("новый экран", () => {
    assert.equal(needsMap([added("frontend/src/screens/docs/DocsScreen.tsx")]).length, 1);
  });
});

describe("что карту не трогает", () => {
  it("правка существующей ручки — дверь та же", () => {
    // Иначе гейт краснел бы на каждой правке чата, и его обошли бы
    // в первый же день.
    assert.deepEqual(needsMap([changed("backend/src/surface/http/routes/chat.ts")]), []);
  });

  it("обычный код", () => {
    assert.deepEqual(needsMap([changed("backend/src/kernel/talk/service.ts")]), []);
  });

  it("оснастка", () => {
    assert.deepEqual(needsMap([changed("tools/checks/check-map.mjs")]), []);
  });

  it("удаление триггерного файла — карта о нём уже не утверждает", () => {
    assert.deepEqual(needsMap([{ status: "D", path: "dock/decisions.md" }]), []);
  });
});

describe("вердикт", () => {
  it("повод есть, карты нет — красный", () => {
    const got = commit([added("dock/decisions.md")]);
    assert.equal(got.ok, false);
    assert.equal(got.triggers.length, 1);
  });

  it("повод есть, карта в том же коммите — зелёный", () => {
    const got = commit([added("dock/decisions.md"), changed(MAP)]);
    assert.equal(got.ok, true);
  });

  it("поводов нет — зелёный, и триггеров ноль", () => {
    const got = commit([changed("frontend/src/screens/talk/Bubble.tsx")]);
    assert.equal(got.ok, true);
    assert.deepEqual(got.triggers, []);
  });

  it("числа возвращаются всегда: зелёный на пустоте виден как пустота", () => {
    // Р-015: у сканирующей проверки числа важнее вердикта.
    assert.equal(commit([]).seen, 0);
  });

  it("слияние не спрашивают", () => {
    const got = commit([changed("dock/debt.md")], "Merge branch 'main' into работа");
    assert.equal(got.ok, true);
  });
});

describe("отказ с причиной", () => {
  it("названная причина проходит", () => {
    const got = commit(
      [changed("dock/decisions.md")],
      "docs(решения): опечатка\n\nкарта: не требуется — поправлена опечатка в тексте",
    );
    assert.equal(got.ok, true);
  });

  it("причина в два слова причиной не считается", () => {
    assert.equal(refusalIn("карта: не требуется — да"), null);
  });

  it("отказ без причины не проходит", () => {
    const got = commit([changed("dock/debt.md")], "chore: правка\n\nкарта: не требуется");
    assert.equal(got.ok, false);
  });
});
