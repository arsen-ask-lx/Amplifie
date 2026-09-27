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
 * Охрана охраны (task-124): конвейер, хуки и настройки агента, вход `make` и манифест
 * гейтов. Их правка без ревью ослабляет все проверки разом — а до task-124 они были
 * «прочим» и уходили вовсе без ревью (правки CI 27.09 — так и ушли бы).
 */
const HARNESS =
  /^(\.github\/|\.claude\/(hooks\/|settings\.json$|commands\/|agents\/)|Makefile$|\.aqk\.yml$)/u;

/**
 * С какого коммита действуют требования task-124: отчёт ревью, причина у исправления,
 * охрана охраны. Граница — первый коммит, добавивший этот файл: прошлые коммиты
 * писались по прежнему правилу, и красить их задним числом нельзя (как `FIRST` у
 * `plan-review-rule.mjs`).
 */
export const STRICT_SINCE = "dock/reviews/README.md";

/**
 * Что файл требует от коммита: `product` — все четыре ступени,
 * `delivery` — только ревью (так ушёл без ревью сторож Р-047), `other` — ничего.
 * `strict` — коммит после границы task-124: охрана охраны тоже поставка.
 */
export function kindOf(path, strict = false) {
  if (TEST.test(path) || SAMPLES.test(path)) return "other";
  if (PRODUCT.test(path)) return "product";
  if (DELIVERY.test(path)) return "delivery";
  if (strict && HARNESS.test(path)) return "delivery";
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
const REPORT = /\bdock\/reviews\/[^\s`)]+\.md\b/u;

/**
 * Отчёт ревью (task-124): строка «ревью: ocr» без отчёта — это слово, а не ревью; 27.09
 * она стояла в коммитах, где шаг правил `ocr` пропускался. Отчёт — в этом же коммите
 * (иначе годился бы любой старый) и называет каждый файл продукта и поставки.
 */
function reportProblem(value, changes, code, reportOf) {
  const path = REPORT.exec(value)?.[0];
  if (!path) return "ревью без отчёта: назови его — `ревью: ocr — …, принято M (dock/reviews/…md)`";
  if (!changes.some((one) => one.path === path && one.status !== "D")) {
    return `отчёт ${path} не в этом коммите — годится только отчёт по этим правкам`;
  }
  const text = reportOf(path) ?? "";
  const missing = code.filter((one) => !text.includes(`\`${one.path}\``)).map((one) => one.path);
  return missing.length === 0 ? null : `отчёт ${path} не называет: ${missing.join(", ")}`;
}

function reviewProblem(text, strict, changes, code, reportOf) {
  const value = lineOf(text, "ревью");
  if (value === null) return "нет строки `ревью: ocr — замечаний N, принято M`";
  if (REVIEW.test(value)) return strict ? reportProblem(value, changes, code, reportOf) : null;
  // После границы отказ от ревью закрыт: «ревью: не требуется — правка CI» обходил бы
  // и отчёт, и охрану охраны (второй разбор критика). Правка мала — есть «мелочь».
  if (strict && /^не требуется/iu.test(value)) {
    return "отказ от ревью закрыт с task-124: нужен отчёт, а для маленькой правки — `мелочь:`";
  }
  if (refusalOf(value)) return null;
  if (shortRefusal(value)) return `причина короче ${REASON_MIN} знаков — это не причина`;
  return "строка `ревью:` без итога: `ocr — замечаний N, принято M` или отказ с причиной";
}

/**
 * Причина исправления (task-124): «чинишь следствие, а не причину» — владелец 27.09.
 * Строка `причина:` ссылается на то, что причину держит: запись долга `Д-NN` или тест
 * в этом же коммите. Фраза без ссылки — ритуал, а не причина.
 */
function causeProblem(text, changes, debtHas) {
  if (!/^fix(\(|!|:)/u.test(text.split("\n")[0] ?? "")) return null;
  const value = lineOf(text, "причина");
  if (value === null) return "исправление без строки `причина: … (Д-NN или тест в коммите)`";
  const debt = /Д-(\d+)/u.exec(value)?.[1];
  // Номер, которого нет в реестре, — та же ритуальная фраза (второй разбор критика).
  if (debt) return debtHas(debt) ? null : `Д-${debt} нет в dock/debt.md этого коммита`;
  const tests = changes.filter((one) => one.status !== "D" && TEST.test(one.path));
  if (tests.some((one) => value.includes(one.path))) return null;
  return "`причина:` не ссылается ни на Д-NN, ни на тест этого коммита";
}

const REVERT = /^This reverts commit [0-9a-f]{7,40}/mu;

/** Сторожа и хуки: ослабить их «мелочью» значит пройти мимо проверки проверок. */
const GUARDS = /^(tools\/checks\/|tools\/gates\/|\.githooks\/)/u;
const isGuard = (path, strict) => GUARDS.test(path) || (strict && HARNESS.test(path));
const SMALL_MAX = 3;

/**
 * Ускоренный путь (владелец 27.09: «даже просто цвет кнопки поменять —
 * план и ревью, это же очень глупо»). Строка `мелочь: причина` заменяет
 * все четыре ступени, но только там, где правка правда мала: порог тот же,
 * что у отказа от плана, плюс не больше трёх файлов кода и не сторожа.
 * Строки `причина:` мелочь не требует — это её назначение (task-124, второй разбор).
 */
function smallVerdict(base, value, changes, code, text, strict) {
  const note = "мелочь — ускоренный путь";
  const refused = (why) => ({
    ...base,
    ok: false,
    needed: true,
    note,
    problems: [{ step: "мелочь", why: `мелочь недопустима: ${why}` }],
  });
  const reason = value.trim();
  if (reason.length < REASON_MIN) return refused(`причина короче ${REASON_MIN} знаков`);
  const guard = code.find((one) => isGuard(one.path, strict));
  if (guard) return refused(`правка сторожа — ${guard.path}`);
  if (code.length > SMALL_MAX) return refused(`файлов кода ${code.length} — больше ${SMALL_MAX}`);
  const product = code.filter((one) => kindOf(one.path) === "product");
  const required = planRequiredBecause(changes, product, text.split("\n")[0] ?? "");
  if (required) return refused(required);
  return { ...base, ok: true, needed: true, note: `${note}: ${reason}` };
}

/**
 * Вердикт по одному коммиту.
 *
 * @param {{ changes: {status: string, path: string}[], message: string, parents: number }} commit
 * @param {(number: string) => ({ path: string, status: string } | null)} planOf —
 *   план `task-NNN` из ТОГО ЖЕ коммита git, а не с диска: иначе незакоммиченный
 *   план засчитался бы, а в чужом клоне было бы красно.
 * @param {{
 *   strict?: boolean,
 *   reportOf?: (path: string) => string | null,
 *   debtHas?: (number: string) => boolean,
 * }} [extra] — `strict` — коммит после границы task-124 (`STRICT_SINCE`); `reportOf` —
 *   текст отчёта ревью из того же коммита git; `debtHas` — есть ли запись `Д-NN` в
 *   реестре долга того же коммита.
 */
export function verdict(
  commit,
  planOf,
  { strict = false, reportOf = () => null, debtHas = () => true } = {},
) {
  const changes = commit.changes ?? [];
  const text = messageOf(commit.message);
  const base = { seen: changes.length, problems: [] };
  const pass = (note) => ({ ...base, ok: true, needed: false, note });

  if ((commit.parents ?? 1) >= 2) return pass("слияние — проверяется его второй родитель");
  if (REVERT.test(text)) return pass("отмена коммита");

  const { product, delivery } = codeOf(changes, strict);
  if (product.length === 0 && delivery.length === 0) {
    return pass("ни продукта, ни поставки — ступени не нужны");
  }

  const small = lineOf(text, "мелочь");
  const code = [...product, ...delivery];
  if (small !== null) return smallVerdict(base, small, changes, code, text, strict);

  const checks = stepChecks(text, changes, product, code, planOf, { strict, reportOf, debtHas });
  const problems = checks.filter(([, why]) => why !== null).map(([step, why]) => ({ step, why }));
  const what = product.length > 0 ? "продукт" : "поставка и оснастка";
  return { ...base, ok: problems.length === 0, needed: true, problems, note: what };
}

/** Файлы кода коммита: продукт — живые; поставка — после границы и удалённые. */
function codeOf(changes, strict) {
  const alive = changes.filter((one) => one.status !== "D");
  const product = alive.filter((one) => kindOf(one.path, strict) === "product");
  // После границы удаление сторожа, хука или конвейера — тоже правка поставки: иначе
  // выключить проверку можно было удалением, без ревью и даже без «мелочи».
  const delivery = (strict ? changes : alive).filter(
    (one) => kindOf(one.path, strict) === "delivery",
  );
  return { product, delivery };
}

/** Ступени коммита парами `[ступень, проблема | null]`: продукту — все, поставке — ревью. */
function stepChecks(text, changes, product, code, planOf, { strict, reportOf, debtHas }) {
  const review = ["ревью", reviewProblem(text, strict, changes, code, reportOf)];
  const cause = strict ? [["причина", causeProblem(text, changes, debtHas)]] : [];
  if (product.length === 0) return [review, ...cause];
  return [
    ["план", planProblem(text, changes, product, planOf)],
    ["тест", testProblem(text, changes, product)],
    ["спека", specProblem(text, changes)],
    review,
    ...cause,
  ];
}
