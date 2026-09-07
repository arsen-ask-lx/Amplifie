#!/usr/bin/env node
/**
 * Живая проверка подключения модели (Р-012).
 *
 * ЗАЧЕМ ИМЕННО ТАК. Проверять «настройки выглядят правильными» бесполезно:
 * подписочный токен живёт год и молча истекает, чужой клиент может быть
 * не установлен, ключ — отозван. Отличить рабочее подключение от нерабочего
 * можно только одним способом — спросить и получить ответ.
 *
 * Это не гейт сборки: без модели продукт работает на правилах, и падать
 * из-за её отсутствия неправильно. Это команда для человека.
 */
import { spawnSync } from "node:child_process";

const asked = "Ответь ровно одним словом: работает";

const probe = `
import { chooseProvider } from "./apps/api/dist/agent/model/choose.js";

const provider = chooseProvider(process.env);
if (!provider) {
  console.log("модель не подключена: AMPLIFIE_MODEL не задан");
  console.log("годятся: claude-cli, codex-cli, anthropic-api, openai-api");
  console.log("продукт при этом работает — на правилах (agent/listening/detect.ts)");
  process.exit(0);
}

console.log(\`провайдер: \${provider.name} (\${provider.billing === "subscription" ? "подписка" : "ключ"})\`);
const started = Date.now();
const answer = await provider.ask({
  system: "Ты отвечаешь коротко и по-русски.",
  prompt: ${JSON.stringify(asked)},
});
console.log(\`ответ за \${Date.now() - started} мс: \${answer.text.slice(0, 200)}\`);
`;

const run = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
  stdio: "inherit",
  env: process.env,
});

if (run.status !== 0) {
  console.error("\nмодель не ответила. Что проверить:");
  console.error("  • подписка — установлен ли клиент и выполнен ли вход;");
  console.error("    у Claude Code годовой токен: claude setup-token");
  console.error("  • ключ — задан ли AMPLIFIE_MODEL_KEY и не отозван ли он");
  console.error("  • подробности выше, в сообщении провайдера\n");
}
process.exit(run.status ?? 1);
