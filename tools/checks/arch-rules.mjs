/**
 * Границы модулей — правила и разбор импортов, без компилятора (Р-047).
 *
 * ⚠️ СВОЙ СТОРОЖ, А НЕ dependency-cruiser. Тот читает исходники через API
 * компилятора TypeScript, а у TypeScript 7 этого API нет до 7.1: сторож
 * обходил ноль модулей и рапортовал «чисто» (Р-015, 07.09 и снова 26.09).
 * Владелец 26.09: «работаем только с TypeScript 7 — не понимает, делаем
 * другого». Импорт в TypeScript — строка в кавычках после `from` или
 * `import(` — её разбору компилятор не нужен.
 *
 * Правила перенесены из `tools/dependency-cruiser.cjs` один в один, вместе
 * с их объяснениями. Каждое доказано подсадкой в `arch-rules.test.mjs`.
 */
import { posix } from "node:path";

/** Тесты: им законно смотреть внутрь модулей. */
const TEST = /\.(test|spec)\.tsx?$/u;

/**
 * Правила: ребро «кто → кого» запрещено, если `from` совпал, а `to` попал.
 * `$1` в `toNot` — имя модуля или раздела, пойманное скобками в `from`:
 * свой repo или свой раздел — можно, чужой — нет.
 */
export const RULES = [
  // --- Кольца бека (dock/architecture.md, «Модули и владельцы знаний») ---
  {
    name: "platform-ничего-не-знает",
    why: "platform — низ стека. Импорт ядра или витрины схлопывает кольца.",
    from: /^backend\/src\/platform\//u,
    to: /^backend\/src\/(kernel|surface)\//u,
  },
  {
    name: "ядро-не-знает-витрин",
    why: "kernel не импортирует surface: иначе витрину не выбросить, не тронув ядро.",
    from: /^backend\/src\/kernel\//u,
    to: /^backend\/src\/surface\//u,
  },
  {
    name: "витрина-не-лезет-в-хранилище",
    why: "surface ходит в модуль только через его index — не в repo и schema (Р-2).",
    from: /^backend\/src\/surface\//u,
    to: /^backend\/src\/kernel\/[^/]+\/(repo|schema)\.ts$/u,
  },
  // --- Порядок модулей ядра: space → identity → talk → work ---
  {
    name: "space-ничего-не-знает",
    why: "space — самый низ ядра: арендатор не знает ни людей, ни разговоров.",
    from: /^backend\/src\/kernel\/space\//u,
    to: /^backend\/src\/kernel\/(identity|talk|work)\//u,
  },
  {
    name: "identity-не-знает-разговоров",
    why: "identity ниже talk: кто существует — не зависит от того, где говорят.",
    from: /^backend\/src\/kernel\/identity\//u,
    to: /^backend\/src\/kernel\/(talk|work)\//u,
  },
  {
    name: "talk-не-знает-работы",
    why: "talk ниже work: разговор существует сам по себе, задача — нет.",
    from: /^backend\/src\/kernel\/talk\//u,
    to: /^backend\/src\/kernel\/work\//u,
  },
  {
    name: "app-зовут-только-витрины",
    why: "Слой сборки src/app/ видит всех — снизу его не должно быть видно.",
    from: /^backend\/src\/(kernel|platform)\//u,
    to: /^backend\/src\/app\//u,
  },
  {
    name: "чужие-внутренности-закрыты",
    why: "Модуль ядра лезет в чужой repo/service мимо index.ts соседа.",
    from: /^backend\/src\/kernel\/([^/]+)\//u,
    fromNot: TEST,
    to: /^backend\/src\/kernel\/[^/]+\/(repo|service)\.ts$/u,
    toNot: "^backend/src/kernel/$1/",
  },
  // --- Слои фронта: shared → data → screens → app ---
  {
    name: "общее-ничего-не-знает",
    why: "shared — низ фронта: импорт data или экрана — общее перестало быть общим.",
    from: /^frontend\/src\/shared\//u,
    to: /^frontend\/src\/(data|screens|app)\//u,
  },
  {
    name: "данные-не-знают-экранов",
    why: "data не импортирует экраны: слой данных проверяется без браузера.",
    from: /^frontend\/src\/data\//u,
    to: /^frontend\/src\/(screens|app)\//u,
  },
  {
    name: "экран-не-знает-оболочки",
    why: "screens не импортирует app: экран работает внутри любой оболочки.",
    from: /^frontend\/src\/screens\//u,
    to: /^frontend\/src\/app\//u,
  },
  {
    name: "разные-разделы-не-переплетаются",
    why: "Экран одного раздела лезет в другой. Общее место для такого — shared/.",
    from: /^frontend\/src\/screens\/([^/]+)\//u,
    to: /^frontend\/src\/screens\/[^/]+\//u,
    toNot: "^frontend/src/screens/$1/",
  },
];

/** Комментарии прочь: импорт в объяснении — не импорт. Строки не трогаем. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

const FROM = /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*["']([^"']+)["']/gu;
const BARE = /\bimport\s*["']([^"']+)["']/gu;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

/** Что файл импортирует — строки путей, как написаны. */
export function importsOf(text) {
  const code = withoutComments(text);
  const found = new Set();
  for (const re of [FROM, BARE, DYNAMIC]) {
    for (const match of code.matchAll(re)) found.add(match[1]);
  }
  return [...found];
}

const CODE = [".ts", ".tsx"];

/**
 * Куда ведёт импорт: путь в репозитории, `null` — пакет (не наше),
 * `undefined` — относительный путь, которого нет на диске. Последнее —
 * слепота разбора, и обход обязан о ней кричать, а не молчать.
 */
export function resolveSpec(fromFile, spec, exists) {
  let base;
  if (spec.startsWith("@/") && fromFile.startsWith("frontend/")) {
    base = posix.join("frontend/src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = posix.join(posix.dirname(fromFile), spec);
  } else {
    return null;
  }
  const stem = base.replace(/\.(m?js|jsx)$/u, "");
  const tries =
    stem === base
      ? [base, ...CODE.map((ext) => base + ext), ...CODE.map((ext) => `${base}/index${ext}`)]
      : [...CODE.map((ext) => stem + ext), base];
  return tries.find(exists);
}

/** Ребро нарушает правило: `from` пойман, `to` попал и не своё. */
function breaks(rule, from, to) {
  const hit = from.match(rule.from);
  if (!hit || rule.fromNot?.test(from) || !rule.to.test(to)) return false;
  if (!rule.toNot) return true;
  return !new RegExp(rule.toNot.replace("$1", hit[1] ?? ""), "u").test(to);
}

/** Нарушения правил на графе `Map<файл, Set<файл>>`. */
export function violations(graph) {
  const out = [];
  for (const [from, targets] of graph) {
    for (const to of targets) {
      for (const rule of RULES.filter((one) => breaks(one, from, to))) {
        out.push({ rule: rule.name, why: rule.why, from, to });
      }
    }
  }
  return out;
}

/**
 * Клубки — сильно связные части графа больше одного файла (Тарьян).
 * Файл, зовущий сам себя, — тоже клубок.
 */
export function cycles(graph) {
  const order = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const found = [];

  /** Снять со стека часть, корнем которой оказался `node`. */
  const close = (node) => {
    const part = [];
    let top;
    do {
      top = stack.pop();
      onStack.delete(top);
      part.push(top);
    } while (top !== node);
    if (part.length > 1 || graph.get(node)?.has(node)) found.push(part);
  };

  /** Пройти к соседу и подтянуть наименьший достижимый номер. */
  const step = (node, next) => {
    if (!order.has(next)) visit(next);
    if (onStack.has(next)) low.set(node, Math.min(low.get(node), low.get(next)));
  };

  const visit = (node) => {
    order.set(node, order.size);
    low.set(node, order.get(node));
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) step(node, next);
    if (low.get(node) === order.get(node)) close(node);
  };

  for (const node of graph.keys()) if (!order.has(node)) visit(node);
  return found;
}

/**
 * Точки входа и тесты — сироты по построению: их никто не импортирует,
 * их запускают (`main`, `*.config.ts` — Vite, drizzle). Остальной файл
 * без единого входящего — мёртвый код или забыли подключить.
 */
const ENTRY =
  /(\.d\.ts$|(^|\/)(main|config)\.tsx?$|\.config\.tsx?$|\.(test|spec)\.tsx?$|\/tests\/)/u;

export function orphans(graph) {
  const called = new Set();
  for (const targets of graph.values()) for (const to of targets) called.add(to);
  return [...graph.keys()].filter((file) => !called.has(file) && !ENTRY.test(file)).sort();
}
