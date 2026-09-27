/**
 * Проверки сторожа границ модулей (Р-047) — подсаженные нарушения.
 *
 * ⚠️ СТОРОЖ, КОТОРЫЙ НИ РАЗУ НЕ КРАСНЕЛ, НЕОТЛИЧИМ ОТ МОЛЧАЩЕГО. Прежний
 * (dependency-cruiser) ослеп на TypeScript 7 и дважды рапортовал «чисто»,
 * обойдя ноль модулей. Здесь каждое правило краснеет на подсадке в памяти —
 * без файлов на диске и без компилятора.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cycles, importsOf, orphans, RULES, resolveSpec, violations } from "./arch-rules.mjs";

/** Граф из пар «кто → кого», как его строит обход. */
const graph = (...edges) => {
  const g = new Map();
  for (const [from, to] of edges) {
    if (!g.has(from)) g.set(from, new Set());
    if (to) {
      g.get(from).add(to);
      if (!g.has(to)) g.set(to, new Set());
    }
  }
  return g;
};
const names = (found) => found.map((one) => one.rule).sort();

describe("что считается импортом", () => {
  it("статический, реэкспорт, динамический, побочный и только-тип", () => {
    const text = [
      'import { a } from "./a.js";',
      'import type { B } from "./b.js";',
      'export { c } from "./c.js";',
      'export * from "./d.js";',
      'import "./e.css";',
      'const f = await import("./f.js");',
      "import {\n  g,\n  h,\n} from './gh.js';",
    ].join("\n");
    assert.deepEqual(importsOf(text).sort(), [
      "./a.js",
      "./b.js",
      "./c.js",
      "./d.js",
      "./e.css",
      "./f.js",
      "./gh.js",
    ]);
  });

  it("импорт в комментарии и в строке-примере — не импорт", () => {
    const text = [
      "// import { x } from './x.js';",
      "/* import { y } from './y.js'; */",
      "/**",
      ' * export { z } from "./z.js";',
      " */",
      'const text = "не import from здесь";',
    ].join("\n");
    assert.deepEqual(importsOf(text), []);
  });
});

describe("куда ведёт импорт", () => {
  const files = new Set([
    "backend/src/kernel/talk/service.ts",
    "backend/src/kernel/talk/index.ts",
    "frontend/src/shared/utils.ts",
    "frontend/src/app/App.tsx",
  ]);
  const exists = (path) => files.has(path);

  it(".js в исходнике — это .ts или .tsx на диске", () => {
    assert.equal(
      resolveSpec("backend/src/kernel/talk/repo.ts", "./service.js", exists),
      "backend/src/kernel/talk/service.ts",
    );
    assert.equal(
      resolveSpec("frontend/src/main.tsx", "./app/App.js", exists),
      "frontend/src/app/App.tsx",
    );
  });

  it("папка — это её index.ts", () => {
    assert.equal(
      resolveSpec("backend/src/app/answering.ts", "../kernel/talk/index.js", exists),
      "backend/src/kernel/talk/index.ts",
    );
  });

  it("псевдоним @/ фронта — от frontend/src", () => {
    assert.equal(
      resolveSpec("frontend/src/shared/ui/button.tsx", "@/shared/utils", exists),
      "frontend/src/shared/utils.ts",
    );
  });

  it("пакет — не наше, пути нет", () => {
    assert.equal(resolveSpec("frontend/src/app/App.tsx", "react", exists), null);
    assert.equal(resolveSpec("frontend/src/app/App.tsx", "@amplifie/contract", exists), null);
  });

  it("относительный путь в никуда — слепота, а не «чужое»", () => {
    assert.equal(resolveSpec("frontend/src/app/App.tsx", "./nope.js", exists), undefined);
  });
});

describe("каждое правило краснеет на подсадке", () => {
  const cases = [
    ["platform-ничего-не-знает", "backend/src/platform/db.ts", "backend/src/kernel/talk/index.ts"],
    [
      "ядро-не-знает-витрин",
      "backend/src/kernel/talk/service.ts",
      "backend/src/surface/http/app.ts",
    ],
    [
      "витрина-не-лезет-в-хранилище",
      "backend/src/surface/http/routes/chat.ts",
      "backend/src/kernel/talk/repo.ts",
    ],
    [
      "space-ничего-не-знает",
      "backend/src/kernel/space/service.ts",
      "backend/src/kernel/identity/index.ts",
    ],
    [
      "identity-не-знает-разговоров",
      "backend/src/kernel/identity/service.ts",
      "backend/src/kernel/talk/index.ts",
    ],
    [
      "talk-не-знает-работы",
      "backend/src/kernel/talk/service.ts",
      "backend/src/kernel/work/index.ts",
    ],
    [
      "app-зовут-только-витрины",
      "backend/src/kernel/talk/service.ts",
      "backend/src/app/answering.ts",
    ],
    [
      "чужие-внутренности-закрыты",
      "backend/src/kernel/talk/service.ts",
      "backend/src/kernel/identity/repo.ts",
    ],
    ["общее-ничего-не-знает", "frontend/src/shared/toast.tsx", "frontend/src/data/api.ts"],
    [
      "данные-не-знают-экранов",
      "frontend/src/data/useChat.ts",
      "frontend/src/screens/talk/Room.tsx",
    ],
    ["экран-не-знает-оболочки", "frontend/src/screens/talk/Room.tsx", "frontend/src/app/App.tsx"],
    [
      "разные-разделы-не-переплетаются",
      "frontend/src/screens/talk/Room.tsx",
      "frontend/src/screens/agents/ModelScreen.tsx",
    ],
  ];

  for (const [rule, from, to] of cases) {
    it(rule, () => {
      assert.deepEqual(names(violations(graph([from, to]))), [rule]);
    });
  }

  it("все объявленные правила проверены подсадкой — нового без красного случая нет", () => {
    assert.deepEqual(RULES.map((one) => one.name).sort(), cases.map(([rule]) => rule).sort());
  });

  it("своё — можно: свой repo, свой раздел, вниз по слоям", () => {
    const fine = graph(
      ["backend/src/kernel/talk/service.ts", "backend/src/kernel/talk/repo.ts"],
      ["backend/src/kernel/talk/service.ts", "backend/src/kernel/identity/index.ts"],
      ["backend/src/surface/http/routes/chat.ts", "backend/src/kernel/talk/index.ts"],
      ["frontend/src/screens/talk/Room.tsx", "frontend/src/screens/talk/Feed.tsx"],
      ["frontend/src/app/App.tsx", "frontend/src/screens/talk/Room.tsx"],
      ["frontend/src/data/useChat.ts", "frontend/src/shared/toast.tsx"],
    );
    assert.deepEqual(violations(fine), []);
  });

  it("тесту модуля можно в чужой repo — как было у прежнего сторожа", () => {
    const fine = graph([
      "backend/src/kernel/talk/service.test.ts",
      "backend/src/kernel/identity/repo.ts",
    ]);
    assert.deepEqual(violations(fine), []);
  });
});

describe("клубки и сироты", () => {
  it("цикл из трёх файлов находится и называется", () => {
    const found = cycles(
      graph(["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"], ["c.ts", "d.ts"]),
    );
    assert.equal(found.length, 1);
    assert.deepEqual([...found[0]].sort(), ["a.ts", "b.ts", "c.ts"]);
  });

  it("без цикла — пусто", () => {
    assert.deepEqual(cycles(graph(["a.ts", "b.ts"], ["b.ts", "c.ts"])), []);
  });

  it("сирота — файл, который никто не зовёт; вход и тест сиротами не бывают", () => {
    const g = graph(
      ["frontend/src/main.tsx", "frontend/src/app/App.tsx"],
      ["frontend/src/lost.ts"],
      ["frontend/src/data/feed.test.ts", "frontend/src/data/feed.ts"],
      ["frontend/src/data/feed.ts"],
      ["frontend/vite.config.ts"],
      ["backend/drizzle.config.ts"],
    );
    assert.deepEqual(orphans(g), ["frontend/src/lost.ts"]);
  });
});
