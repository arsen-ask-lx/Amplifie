/**
 * Архитектурные границы. Правило по умолчанию — ЗАПРЕТ:
 * чего нет в разрешённых рёбрах, то красное.
 *
 * Модули появились 2026-09-04 вместе со срезом «вход» — границы объявлены
 * в тот же день. Гейт стережёт существующий артефакт, но и не отстаёт от него.
 *
 * Кольца (dock/04-каркас.md §5):
 *   platform  — низ, не зависит ни от кого
 *   kernel/*  — ядро: правится только миграцией данных
 *   surface/* — снаружи: выбрасывается целиком, ядра не касаясь
 */
const TEST = ".(test|spec).ts$";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Циклы в импортах — начало клубка. Разорви через модуль-лист.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-dev-dep-in-prod",
      severity: "error",
      comment: "Прод-код тянет devDependency — в контейнере её нет, упадёт в рантайме.",
      from: { path: "^apps", pathNot: TEST },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Файл никто не импортирует — мёртвый код либо забыли подключить.",
      from: {
        orphan: true,
        // Точки входа и тесты — сироты по построению, это не нарушение.
        pathNot: `.d.ts$|(^|/)(main|config|drizzle.config).ts$|${TEST}|/tests/`,
      },
      to: {},
    },

    // --- Кольца ---
    {
      name: "platform-ничего-не-знает",
      severity: "error",
      comment:
        "platform — низ стека. Если он импортирует ядро или витрину, кольца схлопнулись " +
        "и менять техническое основание станет так же дорого, как модель данных.",
      from: { path: "^backend/src/platform/" },
      to: { path: "^backend/src/(kernel|surface)/" },
    },
    {
      name: "ядро-не-знает-витрин",
      severity: "error",
      comment:
        "kernel не импортирует surface. Иначе витрину нельзя выбросить, не тронув ядро — " +
        "а это единственное, ради чего кольца и заведены.",
      from: { path: "^backend/src/kernel/" },
      to: { path: "^backend/src/surface/" },
    },
    {
      name: "витрина-не-лезет-в-хранилище",
      severity: "error",
      comment:
        "surface не импортирует repo и schema напрямую — только публичный index модуля. " +
        "Иначе появляются жирные вьюхи и путь записи в обход службы (Р-2).",
      from: { path: "^backend/src/surface/" },
      to: { path: "^backend/src/kernel/[^/]+/(repo|schema).ts$" },
    },
    // --- Порядок модулей ядра: space → identity → talk → work ---
    // Нижний НЕ знает про верхний. Запрещаем ровно обратные рёбра.
    // ⚠️ no-circular это НЕ ловит: он смотрит на файлы, а взаимная зависимость
    // возникает на уровне модулей (инцидент 2026-09-06 — identity позвал talk).
    // Нужно довесить работу соседа сверху — это делает слой сборки src/app/,
    // передав операцию в ту же транзакцию.
    {
      name: "space-ничего-не-знает",
      severity: "error",
      comment: "space — самый низ ядра: арендатор не знает ни про людей, ни про разговоры.",
      from: { path: "^backend/src/kernel/space/" },
      to: { path: "^backend/src/kernel/(identity|talk|work)/" },
    },
    {
      name: "identity-не-знает-разговоров",
      severity: "error",
      comment:
        "identity ниже talk: кто существует — не зависит от того, где говорят. " +
        "Обратное делает пару взаимно зависимой, и ни один модуль нельзя " +
        "ни выбросить, ни понять отдельно.",
      from: { path: "^backend/src/kernel/identity/" },
      to: { path: "^backend/src/kernel/(talk|work)/" },
    },
    {
      name: "talk-не-знает-работы",
      severity: "error",
      comment: "talk ниже work: разговор существует сам по себе, задача — нет.",
      from: { path: "^backend/src/kernel/talk/" },
      to: { path: "^backend/src/kernel/work/" },
    },
    {
      name: "app-зовут-только-витрины",
      severity: "error",
      comment:
        "Слой сборки src/app/ видит все модули — поэтому его не должно быть " +
        "видно снизу. Импорт app из ядра вернёт ту же взаимную зависимость.",
      from: { path: "^backend/src/(kernel|platform)/" },
      to: { path: "^backend/src/app/" },
    },
    {
      name: "чужие-внутренности-закрыты",
      severity: "error",
      comment:
        "Модуль ядра лезет во внутренности соседа мимо его index.ts. " +
        "Каждый модуль владеет своими таблицами; чужое читается только через " +
        "публичные операции. $1 — обратная ссылка на имя модуля слева: " +
        "свой repo/service импортировать можно, чужой нельзя.",
      from: { path: "^backend/src/kernel/([^/]+)/", pathNot: TEST },
      to: {
        path: "^backend/src/kernel/[^/]+/(repo|service).ts$",
        pathNot: "^backend/src/kernel/$1/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/|(^|/)migrations/" },
    // КОРНЕВОЙ tsconfig.json, а не база настроек. База переехала в tools/,
    // и указание на неё роняет обход: TypeScript ищет входные файлы рядом
    // с конфигурацией, а в tools/ нет ни одного .ts — TS18003.
    // Корневой файл ссылается на все проекты и разрешает пути так же:
    // 65 модулей и 127 связей до и после, подсадка ловится.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
