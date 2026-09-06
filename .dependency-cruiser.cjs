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
      from: { path: "^apps/api/src/platform/" },
      to: { path: "^apps/api/src/(kernel|surface)/" },
    },
    {
      name: "ядро-не-знает-витрин",
      severity: "error",
      comment:
        "kernel не импортирует surface. Иначе витрину нельзя выбросить, не тронув ядро — " +
        "а это единственное, ради чего кольца и заведены.",
      from: { path: "^apps/api/src/kernel/" },
      to: { path: "^apps/api/src/surface/" },
    },
    {
      name: "витрина-не-лезет-в-хранилище",
      severity: "error",
      comment:
        "surface не импортирует repo и schema напрямую — только публичный index модуля. " +
        "Иначе появляются жирные вьюхи и путь записи в обход службы (Р-2).",
      from: { path: "^apps/api/src/surface/" },
      to: { path: "^apps/api/src/kernel/[^/]+/(repo|schema).ts$" },
    },
    {
      name: "чужие-внутренности-закрыты",
      severity: "error",
      comment:
        "Модуль ядра лезет во внутренности соседа мимо его index.ts. " +
        "Каждый модуль владеет своими таблицами; чужое читается только через " +
        "публичные операции. $1 — обратная ссылка на имя модуля слева: " +
        "свой repo/service импортировать можно, чужой нельзя.",
      from: { path: "^apps/api/src/kernel/([^/]+)/", pathNot: TEST },
      to: {
        path: "^apps/api/src/kernel/[^/]+/(repo|service).ts$",
        pathNot: "^apps/api/src/kernel/$1/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/|(^|/)migrations/" },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
  },
};
