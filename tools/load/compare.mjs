#!/usr/bin/env node
/**
 * Сверка двух измерителей нагрузки на одних условиях (task-122, Р-051).
 *
 * Свой прибор (`measure.mjs`) и k6 (`k6/delivery.js`) по очереди: оба в сети
 * стенда, оба через Caddy, вкладки только слушают (`SYNC=0`). Каждый печатает
 * строку `ИТОГ-JSON`; здесь они сводятся рядом, а русские отчёты идут на экран
 * как есть — их никто не разбирает.
 *
 * ⚠️ РАСХОЖДЕНИЕ — НЕ «ПРОЙДЕНО С ОГОВОРКОЙ». Доля доставки расходится больше
 * чем на 1 п.п. или половина и 0.9 ответа на отправку — больше чем на 20% —
 * код выхода не ноль: один из приборов врёт, и это надо разобрать.
 *
 * ⚠️ СВЕРЯЮТСЯ ТОЛЬКО ЧЕСТНЫЕ ПРОГОНЫ. Прибор, вышедший с ненулевым кодом (k6 — при
 * нарушенном пороге), пустой замер, разный объём у двух приборов, переподключения
 * у своего или не тот режим — сверка красная до всякого сравнения чисел: иначе
 * «сошлось» значило бы «оба ничего не намерили».
 *
 * Следы в базе стенда — два пространства на прогон; чистит `make reset`.
 *
 * Запуск: make k6-compare (стенд поднят; тяжело — сначала make conditions).
 */
import { spawnSync } from "node:child_process";

const TABS = process.env.TABS ?? "100";
const RATE = process.env.RATE ?? "10";
const SEND_S = process.env.SEND_S ?? "200";
const root = process.cwd().replaceAll("\\", "/");
/** Тот же Node, что в образах продукта, — по отпечатку, как и k6. */
const NODE_IMAGE =
  "node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2";

/** Запустить прибор, показать его отчёт и вернуть строку итога. */
function measured(args) {
  const run = spawnSync("docker", ["run", "--rm", "--network", "amplifie_default", ...args], {
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  const line = (run.stdout ?? "").split("\n").find((one) => one.startsWith("ИТОГ-JSON "));
  if (!line) throw new Error(`прибор не дал строки итога (код ${run.status})`);
  return { ...JSON.parse(line.slice("ИТОГ-JSON ".length)), exitCode: run.status };
}

const ours = measured([
  ...["-v", `${root}:/work:ro`, "-w", "/work"],
  ...["-e", "AMPLIFIE_BASE_URL=http://caddy:80", "-e", "SYNC=0"],
  ...["-e", `TABS=${TABS}`, "-e", `RATE=${RATE}`, "-e", `SECONDS=${SEND_S}`],
  NODE_IMAGE,
  ...["node", "tools/load/measure.mjs"],
]);
const theirs = measured([
  ...["-v", `${root}/tools/load/k6:/scripts:ro`],
  ...["-e", `TABS=${TABS}`, "-e", `RATE=${RATE}`, "-e", `SEND_S=${SEND_S}`],
  "amplifie-k6-sse",
  ...["run", "--quiet", "/scripts/delivery.js"],
]);

/** Что делает прогон несравнимым — до всяких чисел. */
const unfair = [
  [ours.exitCode !== 0, `свой прибор вышел с кодом ${ours.exitCode}`],
  [theirs.exitCode !== 0, `k6 вышел с кодом ${theirs.exitCode} — нарушен его порог`],
  [!(ours.sent > 0 && theirs.sent > 0), "пустой замер: отправок ноль"],
  [String(ours.tabs) !== TABS || String(theirs.tabs) !== TABS, "открыто не столько вкладок"],
  [Math.abs(ours.sent - theirs.sent) > 0.05 * Math.max(ours.sent, theirs.sent), "разный объём"],
  [ours.sync !== false, "свой прибор шёл не в режиме «только слушают»"],
  [ours.reconnects > 0, `свой прибор переподключался ${ours.reconnects} раз — k6 этого не делает`],
  [ours.ownLimit > 0 || theirs.ownLimit > 0, "упёрлись в свой порог — числа не про сервер"],
].filter(([bad]) => bad);

/** Одна цифра после запятой: сотые доли миллисекунды шумят и ничего не говорят. */
const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
const differs = (a, b, share) => Math.abs(a - b) > share * Math.max(a, b);
const verdicts = [
  ["доля доставки", ours.share, theirs.share, Math.abs(ours.share - theirs.share) > 0.01],
  ...["p50", "p90"].map((p) => [
    `ответ на отправку, ${p}`,
    ours.sendMs?.[p],
    theirs.sendMs?.[p],
    differs(ours.sendMs?.[p] ?? 0, theirs.sendMs?.[p] ?? 0, 0.2),
  ]),
];

console.log("\n── сверка приборов ─────────────────────────────");
console.log(`вкладок: свой ${ours.tabs} · k6 ${theirs.tabs}`);
console.log(`отправлено: свой ${ours.sent} · k6 ${theirs.sent}`);
for (const [what, a, b, bad] of verdicts) {
  console.log(`${bad ? "✗" : "✓"} ${what}: свой ${round(a)} · k6 ${round(b)}`);
}
console.log(
  `ответ на отправку, p99 (не сверяется): свой ${round(ours.sendMs?.p99)} · k6 ${round(theirs.sendMs?.p99)}`,
);
console.log(
  `доставка до чужой вкладки (только k6): ${["p50", "p90", "p99"].map((p) => `${p} ${round(theirs.deliveryMs?.[p])}`).join(" · ")} мс`,
);
for (const [, why] of unfair) console.log(`✗ прогон несравним: ${why}`);

process.exit(unfair.length > 0 || verdicts.some(([, , , bad]) => bad) ? 1 : 0);
