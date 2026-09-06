/**
 * Архитектурные границы.
 *
 * Правило из плейбука: гейт стережёт СУЩЕСТВУЮЩИЙ артефакт.
 * Сейчас модулей ядра ещё нет, поэтому здесь только те запреты,
 * которые имеют смысл на пустом каркасе. Границы модулей
 * (kernel/* не импортирует agent/*, surface не лезет в repo и т.д.)
 * добавляются В ТОТ ЖЕ ДЕНЬ, когда появляется первый модуль.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Циклы в импортах — начало клубка. Разорви через отдельный модуль-лист.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-dev-dep-in-prod",
      severity: "error",
      comment: "Прод-код тянет devDependency — в контейнере её не будет, упадёт в рантайме.",
      from: { path: "^apps", pathNot: ".(test|spec).ts$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Файл никто не импортирует — либо мёртвый код, либо забыли подключить.",
      from: { orphan: true, pathNot: ".d.ts$|(^|/)(config|main).ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/" },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
  },
};
