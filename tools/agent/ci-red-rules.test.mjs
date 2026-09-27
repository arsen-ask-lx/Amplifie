/**
 * Проверки чистых правил сторожа CI (task-126, шаг 2).
 *
 * ⚠️ ФРАГМЕНТЫ ЖУРНАЛА — НАСТОЯЩИЕ. Три образца ниже (csp, unread-own, «Цена
 * горячих запросов») взяты дословно из `gh run view 36329661650 --log-failed`
 * (работы `ui (1/3)`, `ui (3/3)`, `acceptance`, 27.09) — только обрезаны до
 * 5–15 строк вокруг падения. Vitest в этом прогоне не падал: его фрагмент —
 * по формату из плана задачи (`FAIL  путь > группа > имя`), а не из живого CI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analysisComplete,
  analysisMissing,
  parseFailedLog,
  parseKnownRed,
  unknownFailures,
} from "./ci-red-rules.mjs";

const CSP_FRAGMENT = `ui (1/3)\tUNKNOWN STEP\t      49 |   await page.keyboard.type("жирно", { delay: 10 });
ui (1/3)\tUNKNOWN STEP\t    > 50 |   await expect(page.getByRole("option").first()).toBeVisible();
ui (1/3)\tUNKNOWN STEP\t         |                                                  ^
ui (1/3)\tUNKNOWN STEP\t      51 |   await page.keyboard.press("Escape");
ui (1/3)\tUNKNOWN STEP\t      52 |
ui (1/3)\tUNKNOWN STEP\t      53 |   await menu(page, "под политикой", "Удалить");
ui (1/3)\tUNKNOWN STEP\t        at /home/runner/work/Amplifie/Amplifie/frontend/tests/ui/csp.spec.ts:50:50
ui (1/3)\tUNKNOWN STEP\t2026-09-27T15:30:33.1073616Z   ✘  19 [chromium] › frontend/tests/ui/csp.spec.ts:19:1 › сквозной путь под политикой содержимого — ни одного нарушения (8.6s)
ui (1/3)\tUNKNOWN STEP\t2026-09-27T15:30:34.9769541Z   ✓  20 [chromium] › frontend/tests/ui/edit-delete.spec.ts:13:1 › удаление спрашивает, а «Отмена» оставляет реплику (1.5s)
ui (1/3)\tUNKNOWN STEP\t2026-09-27T15:30:36.3279314Z   ✓  21 [chromium] › frontend/tests/ui/edit-delete.spec.ts:29:1 › стрелка вверх в пустом поле открывает правку последней своей (1.3s)`;

const CSP_KEY =
  "frontend/tests/ui/csp.spec.ts › сквозной путь под политикой содержимого — ни одного нарушения";

const UNREAD_OWN_FRAGMENT = `ui (3/3)\tUNKNOWN STEP\t    > 64 |     .toBeGreaterThanOrEqual(last);
ui (3/3)\tUNKNOWN STEP\t         |      ^
ui (3/3)\tUNKNOWN STEP\t      65 |
ui (3/3)\tUNKNOWN STEP\t      66 |   const seen = await page.evaluate(
ui (3/3)\tUNKNOWN STEP\t      67 |     () => (window as unknown as { unreadLineSeen: boolean }).unreadLineSeen,
ui (3/3)\tUNKNOWN STEP\t        at /home/runner/work/Amplifie/Amplifie/frontend/tests/ui/unread-own.spec.ts:64:6
ui (3/3)\tUNKNOWN STEP\t2026-09-27T15:33:06.8012022Z   ✘  41 [chromium] › frontend/tests/ui/unread-own.spec.ts:21:1 › отправил в новый чат — черты «Непрочитанные» нет ни на миг (11.5s)
ui (3/3)\tUNKNOWN STEP\t2026-09-27T15:33:10.6439711Z   ✓  42 [chromium] › frontend/tests/ui/unread.spec.ts:41:1 › непрочитанное видно числом у канала и чертой в ленте (2.9s)
ui (3/3)\tUNKNOWN STEP\t2026-09-27T15:33:31.4326643Z ##[notice]  1 failed`;

const UNREAD_OWN_KEY =
  "frontend/tests/ui/unread-own.spec.ts › отправил в новый чат — черты «Непрочитанные» нет ни на миг";

// Тот же прогон, будто соседняя правка сдвинула файл на четыре строки вниз (В-1).
const CSP_FRAGMENT_SHIFTED = CSP_FRAGMENT.replace(
  /csp\.spec\.ts:50:50/u,
  "csp.spec.ts:54:50",
).replace(/csp\.spec\.ts:19:1/u, "csp.spec.ts:23:1");

const COST_STEP_FRAGMENT = `acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2417601Z   прирост 989998 при разрешённых 10
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2417831Z
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2418190Z   ПОЧИНИТЬ: посмотри план запроса и найди узел, который читает всё.
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2418996Z   Так уже было: свежесть канала считалась обходом всей переписки,
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2419572Z   потому что индекса под MAX(created_at) нет (Д-30).
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2419846Z
acceptance\tЦена горячих запросов\t2026-09-27T15:29:50.2643224Z ##[error]Process completed with exit code 1.`;

const COST_STEP_KEY = "acceptance | Цена горячих запросов";

// Формат из плана задачи; в прогоне 36329661650 Vitest не падал.
const VITEST_FRAGMENT = `backend\tЗапустить тесты\t2026-09-27T15:29:00.0000000Z  FAIL  backend/tests/x.e2e.test.ts > группа > имя
backend\tЗапустить тесты\t2026-09-27T15:29:00.1000000Z
backend\tЗапустить тесты\t2026-09-27T15:29:00.2000000Z Error: expected 200, got 500`;

const VITEST_KEY = "backend/tests/x.e2e.test.ts > группа > имя";

describe("parseFailedLog", () => {
  it("находит упавший Playwright по настоящему фрагменту журнала (csp)", () => {
    assert.deepEqual(parseFailedLog(CSP_FRAGMENT), [CSP_KEY]);
  });

  it("находит упавший Playwright по настоящему фрагменту журнала (unread-own)", () => {
    assert.deepEqual(parseFailedLog(UNREAD_OWN_FRAGMENT), [UNREAD_OWN_KEY]);
  });

  it("находит упавший прочий шаг по настоящему фрагменту журнала (цена запросов)", () => {
    assert.deepEqual(parseFailedLog(COST_STEP_FRAGMENT), [COST_STEP_KEY]);
  });

  it("находит упавший Vitest по формату «FAIL путь > группа > имя»", () => {
    assert.deepEqual(parseFailedLog(VITEST_FRAGMENT), [VITEST_KEY]);
  });

  it("склеивает все три настоящих фрагмента без потери и без дублей", () => {
    const all = parseFailedLog([CSP_FRAGMENT, UNREAD_OWN_FRAGMENT, COST_STEP_FRAGMENT].join("\n"));
    assert.deepEqual(all, [CSP_KEY, UNREAD_OWN_KEY, COST_STEP_KEY]);
  });

  it("упавшая работа без узнанных строк — сама упавшее, а не тишина (ревью task-126)", () => {
    // Настоящие строки `gh run view 36336053261 --log-failed`: gh свалил шаги фаззера
    // в «UNKNOWN STEP», и первая редакция разбора теряла это падение молча.
    const fuzz = [
      "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4264530Z ___________________________ PATCH /v1/messages/{id} ____________________________",
      "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4265633Z 1. Test Case ID: 3GXJ0j",
      "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.8945733Z ##[error]Process completed with exit code 2.",
    ].join("\n");
    assert.deepEqual(parseFailedLog(fuzz), ["api-fuzz (1/4) | неразобрано"]);
  });

  // Настоящие строки `gh run view 36336053261 --log-failed` (27.09).
  const Stateful = [
    "api-fuzz (stateful)\tАрбитр описания API\t2026-09-27T17:19:44.0994834Z ________________________________ Stateful tests ________________________________",
    "api-fuzz (stateful)\tАрбитр описания API\t2026-09-27T17:19:44.0995581Z 1. Test Case ID: NB2VZC",
    "api-fuzz (stateful)\tАрбитр описания API\t2026-09-27T17:19:44.0996173Z - Resource is not available after creation",
    "api-fuzz (stateful)\tАрбитр описания API\t2026-09-27T17:19:44.7767095Z ##[error]Process completed with exit code 2.",
  ].join("\n");
  const PatchMessage = [
    "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4264530Z ___________________________ PATCH /v1/messages/{id} ____________________________",
    "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4265633Z 1. Test Case ID: 3GXJ0j",
    "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4266232Z - API rejected schema-compliant request",
    "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.4287609Z   - PATCH /v1/messages/{id}",
    "api-fuzz (1/4)\tUNKNOWN STEP\t2026-09-27T17:26:50.8945733Z ##[error]Process completed with exit code 2.",
  ].join("\n");

  it("фаззер — дверь и вид нарушения, а не «работа | шаг» (второе ревью task-126)", () => {
    assert.deepEqual(parseFailedLog(Stateful), [
      "Schemathesis › Stateful tests › Resource is not available after creation",
    ]);
    assert.deepEqual(parseFailedLog(PatchMessage), [
      "Schemathesis › PATCH /v1/messages/{id} › API rejected schema-compliant request",
    ]);
  });

  it("другое нарушение того же шага фаззера — другой ключ, а не «уже известное»", () => {
    const other = Stateful.replace("- Resource is not available after creation", "- Server error");
    assert.deepEqual(parseFailedLog(other), ["Schemathesis › Stateful tests › Server error"]);
  });

  it("строка без таба-префикса (работа/шаг) не разбирается", () => {
    assert.deepEqual(parseFailedLog("✘  1 [chromium] › a.spec.ts:1:1 › имя"), []);
  });
});

describe("unknownFailures (В-1)", () => {
  it("известное падение — пусто", () => {
    const known = parseKnownRed(`${CSP_KEY} | Д-80\n`).known;
    assert.deepEqual(unknownFailures([CSP_KEY], known), []);
  });

  it("известное плюс новое — в списке только новое", () => {
    const known = parseKnownRed(`${CSP_KEY} | Д-80\n`).known;
    assert.deepEqual(unknownFailures([CSP_KEY, UNREAD_OWN_KEY], known), [UNREAD_OWN_KEY]);
  });

  it("сдвиг номера строки и номера теста не делает известное новым", () => {
    const known = parseKnownRed(`${CSP_KEY} | Д-80\n`).known;
    const shifted = parseFailedLog(CSP_FRAGMENT_SHIFTED);
    assert.deepEqual(shifted, [CSP_KEY]);
    assert.deepEqual(unknownFailures(shifted, known), []);
  });
});

describe("parseKnownRed", () => {
  it("разбирает строку, комментарий и пустую строку", () => {
    const { known, errors } = parseKnownRed(`# комментарий\n\n${CSP_KEY} | Д-80\n`);
    assert.equal(known.get(CSP_KEY), "Д-80");
    assert.deepEqual(errors, []);
  });

  it("строка без Д-NN — ошибка", () => {
    const { errors } = parseKnownRed(`${CSP_KEY} | причина без тикета\n`);
    assert.equal(errors.length, 1);
  });
});

describe("analysisComplete (В-2)", () => {
  const full = [
    "## Текст падения",
    "assert.equal ожидал 10, получил 3.",
    "",
    "## Класс",
    "тест",
    "",
    "## Причина",
    "признак ждал отметку, которой продукт не шлёт.",
    "",
    "## Что уже описано",
    "Д-88.",
  ].join("\n");

  it("все четыре раздела с текстом — полный", () => {
    assert.equal(analysisComplete(full), true);
  });

  it("раздела нет вовсе — неполный", () => {
    const without = full.replace(/## Что уже описано\nД-88\.\n?/u, "");
    assert.equal(analysisComplete(without), false);
  });

  it("раздел есть, но пуст — неполный", () => {
    const empty = full.replace("тест", "");
    assert.equal(analysisComplete(empty), false);
  });

  it("класс не из списка — неполный", () => {
    const bad = full.replace("## Класс\nтест", "## Класс\nхз");
    assert.equal(analysisComplete(bad), false);
  });
});

describe("analysisMissing — разбор про те падения (второе ревью task-126)", () => {
  it("разбор, не называющий упавшее, его не объясняет", () => {
    const text = `## Текст падения\n\`${CSP_KEY}\`: не нашёлся пункт.`;
    assert.deepEqual(analysisMissing(text, [CSP_KEY, UNREAD_OWN_KEY]), [UNREAD_OWN_KEY]);
  });

  it("названы все — пусто", () => {
    const text = `\`${CSP_KEY}\` и \`${UNREAD_OWN_KEY}\``;
    assert.deepEqual(analysisMissing(text, [CSP_KEY, UNREAD_OWN_KEY]), []);
  });
});
