/**
 * План, тест, спека и ревью — строками в сообщении коммита (task-116).
 *
 * ЗАЧЕМ. Владелец 26.09: «мы вообще делали план? у нас есть путь план — тест —
 * код — ревью или нет». Не было: с 24.09 два десятка коммитов в продукт ушли
 * без плана, без изменения спеки и без ревью, хотя всё это записано в
 * AGENTS.md. Правило-свойство текстом не держится (Heym, 21.08.2026: предел,
 * который нельзя нарушить одной правкой, агент нарушал в трети файлов) —
 * держит сторож. Приём тот же, что у карты: строка в сообщении, честный
 * отказ с причиной, хук и проверка истории.
 *
 * ⚠️ ОТКАЗ ОТ ПЛАНА ОГРАНИЧЕН ПОРОГОМ, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА. Без
 * порога «план: не требуется — мелкая правка» проходит на любой работе, и
 * гейт превращается в четыре дежурные строки. Порог — из правил плана
 * (`dock/tasks/README.md`): форма данных, протокол, новая дверь, больше
 * одного набора правок. Доказательство — подсадки из настоящих коммитов
 * Р-044 и Р-045, которые правило обязано красить.
 *
 * ⚠️ ЧИСТОЕ ПРАВИЛО ОТДЕЛЬНО ОТ ЗАПУСКА. Здесь нет git и диска: план
 * приходит функцией `planOf`, чтобы подсадки жили в обычном тесте.
 */

/**
 * Тесты и образцы гейтов: ступеней не требуют, тесты засчитываются тестом.
 * Образцы — только `red/` и `green/`: сам код гейта (`check.sh`) — оснастка,
 * и его правка без ревью ровно то, что правило ловит.
 */
const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)tests\/)/u;
const SAMPLES = /^tools\/gates\/[^/]+\/(red|green)\//u;

const PRODUCT = /^((backend|frontend|bridge)\/src\/|packages\/[^/]+\/src\/|backend\/migrations\/)/u;
const DELIVERY =
  /^(tools\/|\.githooks\/|frontend\/index\.html$|compose[^/]*\.ya?ml$)|(^|\/)(Dockerfile|Caddyfile)$/u;

/**
 * Что файл требует от коммита: `product` — все четыре ступени,
 * `delivery` — только ревью (так ушёл без ревью сторож Р-047), `other` — ничего.
 */
export function kindOf(path) {
  if (TEST.test(path) || SAMPLES.test(path)) return "other";
  if (PRODUCT.test(path)) return "product";
  if (DELIVERY.test(path)) return "delivery";
  return "other";
}

/** Сторона продукта: чей тест доказывает правку этого файла. */
function sideOf(path) {
  if (path.startsWith("backend/")) return "backend";
  const pkg = /^packages\/([^/]+)\//u.exec(path);
  if (pkg) return `packages/${pkg[1]}`;
  return path.split("/")[0];
}

/** Сообщение без черты `git commit -v` и без строк-комментариев шаблона. */
export function messageOf(message) {
  const lines = [];
  for (const line of (message ?? "").split("\n")) {
    if (/^#\s*-+\s*>8/u.test(line)) break;
    if (!line.startsWith("#")) lines.push(line);
  }
  return lines.join("\n");
}

const REASON_MIN = 10;

/** Значение строки `ступень: …` — или null. Регистр букв не важен. */
function lineOf(text, step) {
  return new RegExp(`^\\s*${step}\\s*:\\s*(.+)$`, "imu").exec(text)?.[1]?.trim() ?? null;
}

/** Причина отказа «не требуется — …», если она названа и не короче порога. */
function refusalOf(value) {
  const reason = /^не требуется\s*[—:-]?\s*(.*)$/iu.exec(value ?? "")?.[1]?.trim() ?? "";
  return reason.length >= REASON_MIN ? reason : null;
}

/** Строка отказа есть, но причина слишком короткая — назвать это прямо. */
function shortRefusal(value) {
  return /^не требуется/iu.test(value ?? "") && refusalOf(value) === null;
}

/** Почему отказ от плана недопустим на этом коммите — или null. */
function planRequiredBecause(changes, product, subject) {
  if (/^feat(\(|!|:)/u.test(subject)) return "тип коммита feat — новое поведение";
  if (changes.some((one) => one.path.startsWith("backend/migrations/"))) {
    return "миграция — форма хранимых данных";
  }
  if (changes.some((one) => one.path.startsWith("packages/contract/src/"))) {
    return "общий договор бека и фронта — протокол";
  }
  const door = changes.find(
    (one) => one.status === "A" && one.path.startsWith("backend/src/surface/http/routes/"),
  );
  if (door) return `новая дверь наружу — ${door.path}`;
  if (product.length > 5) return `продуктовых файлов ${product.length} — больше пяти`;
  return null;
}

const PLAN_OK = /одобрен|на ревью/iu;

/** Годится ли план `task-NNN`, на который сослался коммит. */
function referencedPlanProblem(number, changes, planOf) {
  const plan = planOf(number);
  if (plan === null) return `плана task-${number} нет в этом коммите git`;
  if (PLAN_OK.test(plan.status)) return null;
  // Сделанный план годится, только если коммит его и дописывает: иначе
  // сошла бы ссылка на давнюю задачу вроде task-001.
  if (/сделано/iu.test(plan.status) && changes.some((one) => one.path === plan.path)) return null;
  return `план task-${number} — «${plan.status}»: годится одобренный или на ревью`;
}

function planProblem(text, changes, product, planOf) {
  const value = lineOf(text, "план");
  const subject = text.split("\n")[0] ?? "";
  if (value === null) return "нет строки `план: task-NNN`";
  const ref = /^task-(\d+)\b/iu.exec(value);
  if (ref) return referencedPlanProblem(ref[1], changes, planOf);
  if (shortRefusal(value)) return `причина короче ${REASON_MIN} знаков — это не причина`;
  if (refusalOf(value) === null) return "строка `план:` не ссылается на task-NNN и не отказ";
  const required = planRequiredBecause(changes, product, subject);
  return required ? `отказ от плана недопустим: ${required}` : null;
}

/** Стороны продукта, чья правка не подкреплена тестом той же стороны. */
function untestedSides(changes, product) {
  const tested = new Set(
    changes.filter((one) => TEST.test(one.path)).map((one) => sideOf(one.path)),
  );
  return [...new Set(product.map((one) => sideOf(one.path)))].filter((side) => !tested.has(side));
}

function testProblem(text, changes, product) {
  const sides = untestedSides(changes, product);
  if (sides.length === 0) return null;
  const value = lineOf(text, "тест");
  if (refusalOf(value)) return null;
  if (shortRefusal(value)) return `причина короче ${REASON_MIN} знаков — это не причина`;
  return `нет теста своей стороны: ${sides.join(", ")}`;
}

function specProblem(text, changes) {
  const value = lineOf(text, "спека");
  if (value === null) return "нет строки `спека: <id изменения>`";
  if (refusalOf(value)) return null;
  if (shortRefusal(value)) return `причина короче ${REASON_MIN} знаков — это не причина`;
  const id = value.split(/\s/u)[0];
  const touched = changes.some(
    (one) =>
      one.path.startsWith(`openspec/changes/${id}/`) ||
      new RegExp(`^openspec/changes/archive/([^/]*-)?${literal(id)}/`, "u").test(one.path),
  );
  return touched ? null : `изменение openspec «${id}» этим коммитом не тронуто`;
}

function literal(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const REVIEW = /^ocr\s*[—:-]\s*замечаний\s+\d+\s*,\s*принято\s+\d+/iu;

function reviewProblem(text) {
  const value = lineOf(text, "ревью");
  if (value === null) return "нет строки `ревью: ocr — замечаний N, принято M`";
  if (REVIEW.test(value) || refusalOf(value)) return null;
  if (shortRefusal(value)) return `причина короче ${REASON_MIN} знаков — это не причина`;
  return "строка `ревью:` без итога: `ocr — замечаний N, принято M` или отказ с причиной";
}

const REVERT = /^This reverts commit [0-9a-f]{7,40}/mu;

/**
 * Вердикт по одному коммиту.
 *
 * @param {{ changes: {status: string, path: string}[], message: string, parents: number }} commit
 * @param {(number: string) => ({ path: string, status: string } | null)} planOf —
 *   план `task-NNN` из ТОГО ЖЕ коммита git, а не с диска: иначе незакоммиченный
 *   план засчитался бы, а в чужом клоне было бы красно.
 */
export function verdict(commit, planOf) {
  const changes = commit.changes ?? [];
  const text = messageOf(commit.message);
  const base = { seen: changes.length, problems: [] };

  if ((commit.parents ?? 1) >= 2) {
    return { ...base, ok: true, needed: false, note: "слияние — проверяется его второй родитель" };
  }
  if (REVERT.test(text)) return { ...base, ok: true, needed: false, note: "отмена коммита" };

  const product = changes.filter((one) => one.status !== "D" && kindOf(one.path) === "product");
  const delivery = changes.filter((one) => one.status !== "D" && kindOf(one.path) === "delivery");
  if (product.length === 0 && delivery.length === 0) {
    return {
      ...base,
      ok: true,
      needed: false,
      note: "ни продукта, ни поставки — ступени не нужны",
    };
  }

  const checks =
    product.length > 0
      ? [
          ["план", planProblem(text, changes, product, planOf)],
          ["тест", testProblem(text, changes, product)],
          ["спека", specProblem(text, changes)],
          ["ревью", reviewProblem(text)],
        ]
      : [["ревью", reviewProblem(text)]];
  const problems = checks.filter(([, why]) => why !== null).map(([step, why]) => ({ step, why }));
  const what = product.length > 0 ? "продукт" : "поставка и оснастка";
  return { ...base, ok: problems.length === 0, needed: true, problems, note: what };
}
