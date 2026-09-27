#!/usr/bin/env node
/**
 * Двери фаззера API и их деление на куски для параллельных работ CI (task-123).
 *
 * ⚠️ ИСКЛЮЧЕНИЯ ЖИВУТ ЗДЕСЬ, В ОДНОМ МЕСТЕ. Раньше они были только флагами
 * `api-fuzz.sh`; делению нужен тот же список, и вторая копия разошлась бы
 * с первой — кусок начал бы бить дверь, которую прогон целиком обходит.
 *
 * ⚠️ ДЕЛИМ СЕМЬЯМИ ДВЕРЕЙ, А НЕ ПУТЯМИ. В Schemathesis 4.28 и фазы examples, coverage,
 * fuzzing берут данные из ответов других дверей (`extra_data_sources.responses`) и
 * идут в порядке зависимостей (`operation_ordering = auto`) — сверено по
 * `config/_phases.py` в закреплённом образе. Разрежь «создать чат» и «реплики чата»
 * по разным кускам — и второй получит выдуманные номера, почти одни 404: проверки
 * зелёные, а глубина меньше. Поэтому производитель и потребитель — в одном куске;
 * тест сверяет это по каждой связи `links` описания.
 *
 * Фаза `stateful` ходит цепочками по всем связям сразу — её прогоняет отдельная
 * работа по всем дверям, без деления.
 *
 * Запуск (читает `api-fuzz.sh`, руками не нужен):
 *   node tools/ops/fuzz-shards.mjs --excluded   исключённые пути, по строке
 *   node tools/ops/fuzz-shards.mjs 2/4          пути второго куска из четырёх
 */
import { readFileSync } from "node:fs";

/**
 * Двери вне прогона — с причиной и арбитром, который держит дверь вместо фаззера.
 * Ослабления одной двери (`positive_data_acceptance` и прочие) — в `api-fuzz.sh`:
 * это настройки проверок, а не состав прогона.
 */
export const EXCLUDED = [
  { path: "/v1/auth/logout", why: "гасит печеньку прогона, дальше всё 401 — auth.e2e" },
  { path: "/v1/stream", why: "SSE, соединение не кончается — приёмочные живых обновлений" },
  { path: "/v1/model/check", why: "без живой модели за мостом только 503 — bridge.e2e" },
  { path: "/metrics", why: "внутренняя дверь: Caddy наружу её не публикует" },
  { path: "/v1/bridge/next", why: "длинный опрос до 25 с: сотня примеров — час; bridge.e2e" },
];

/**
 * Семьи, которые делят данные: номер, выданный одной дверью, нужен другой.
 * Остальные пути — семья по первому слову после `/v1/`.
 */
const JOINED = {
  messages: "conversations", // реплика рождается в чате: POST /conversations/{id}/messages
  invites: "auth", // токен приглашения нужен входу: POST /auth/join
  bridge: "bridges", // код подключения от человека нужен машине: /bridge/join
};

/** Семья пути: `/v1/messages/{id}/pin` → `conversations`. */
export function familyOf(path) {
  const word = path.split("/")[path.startsWith("/v1/") ? 2 : 1];
  return JOINED[word] ?? word;
}

const METHODS = new Set(["get", "put", "post", "patch", "delete", "head", "options", "query"]);

/** Пути прогона: семья и число операций — в порядке описания. */
export function pathsOf(spec) {
  const excluded = new Set(EXCLUDED.map((one) => one.path));
  return Object.entries(spec.paths)
    .filter(([path]) => !excluded.has(path))
    .map(([path, item]) => ({
      path,
      family: familyOf(path),
      operations: Object.keys(item).filter((key) => METHODS.has(key)).length,
    }))
    .filter((one) => one.operations > 0);
}

/**
 * Разложить пути на `count` кусков целыми семьями, ровняя по числу операций.
 *
 * Жадно: самая тяжёлая семья — в самый лёгкий кусок; при равенстве — по имени
 * семьи. Порядок детерминирован: одна и та же схема на любой машине даёт одни
 * и те же куски, иначе работы CI поделили бы двери по-разному.
 */
export function shards(paths, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`кусков должно быть ≥ 1: ${count}`);
  const families = new Map();
  for (const one of paths) {
    const family = families.get(one.family) ?? { name: one.family, operations: 0, paths: [] };
    family.operations += one.operations;
    family.paths.push(one.path);
    families.set(one.family, family);
  }
  const sorted = [...families.values()].sort(
    (a, b) => b.operations - a.operations || a.name.localeCompare(b.name),
  );
  const buckets = Array.from({ length: count }, () => ({ operations: 0, paths: [] }));
  for (const family of sorted) {
    const lightest = buckets.reduce((best, bucket) =>
      bucket.operations < best.operations ? bucket : best,
    );
    lightest.paths.push(...family.paths);
    lightest.operations += family.operations;
  }
  return buckets.map((bucket) => bucket.paths.sort());
}

function main(argument) {
  if (argument === "--excluded") {
    for (const one of EXCLUDED) console.log(one.path);
    return;
  }
  const match = /^(\d+)\/(\d+)$/u.exec(argument ?? "");
  if (!match) throw new Error(`нужно «--excluded» или «номер/всего», например 2/4: ${argument}`);
  const [index, count] = [Number(match[1]), Number(match[2])];
  if (index < 1 || index > count) throw new Error(`кусок ${index} вне 1..${count}`);
  const spec = JSON.parse(readFileSync(new URL("../../backend/openapi.json", import.meta.url)));
  for (const path of shards(pathsOf(spec), count)[index - 1]) console.log(path);
}

// Запущен сам, а не импортирован тестом (Node ≥ 24.2).
if (import.meta.main) main(process.argv[2]);
