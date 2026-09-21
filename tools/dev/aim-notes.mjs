import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Приёмник замечаний: браузер присылает «вот это не так», файл копит.
 *
 * ЗАЧЕМ ФАЙЛ, А НЕ ВЫВОД В КОНСОЛЬ. Замечаний бывает десяток подряд,
 * и человек не должен ждать, пока каждое разберут. Он проходит по экрану,
 * тыкает во всё подряд, а разбор идёт потом и по списку.
 *
 * ⚠️ ТОЛЬКО ДЕВ-СЕРВЕР. Это не часть приложения: ни в образ, ни в сборку
 * не попадает — плагин живёт в `tools/`, которое в продукт не идёт.
 */

const ROUTE = "/__aim";

/**
 * Куда копятся замечания. Читается человеком и агентом, поэтому markdown.
 *
 * Путь считается от этого файла, а не от рабочего каталога: дев-сервер
 * запускается из `frontend/`, и относительный путь увёл бы замечания туда.
 */
const NOTES = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
  "dock/reference/ui-notes.md",
);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Одно замечание одной записью.
 *
 * Компоненты идут первыми и своей строкой: по ним открывают файл, и они
 * должны находиться глазами, а не вычитываться из абзаца. Классы —
 * вторым ключом: по ним находится точная строка внутри файла.
 */
function entry({ aim, text, tag, classes, sample }) {
  const when = new Date().toLocaleString("ru-RU");
  return [
    `\n## ${text}`,
    ``,
    `- **где:** \`${aim ?? "компонент не определён"}\``,
    `- **что:** \`<${tag}>\`${sample ? ` — «${sample}»` : ""}`,
    `- **классы:** \`${classes || "—"}\``,
    `- **когда:** ${when}`,
    ``,
  ].join("\n");
}

export function aimNotes() {
  return {
    name: "amplifie-aim-notes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(ROUTE, (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        void (async () => {
          try {
            const note = await readBody(request);
            await mkdir(dirname(NOTES), { recursive: true });
            await appendFile(NOTES, entry(note), "utf8");
            // В консоль дев-сервера тоже: человек видит, что замечание
            // не улетело в никуда, не открывая файл.
            server.config.logger.info(`замечание: ${note.text} → ${note.aim ?? note.tag}`);
            response.statusCode = 204;
            response.end();
          } catch (error) {
            // Не глотаем: замечание, которое не записалось, обязано
            // сказать об этом — иначе человек будет думать, что оно учтено.
            server.config.logger.error(`замечание не записано: ${String(error)}`);
            response.statusCode = 500;
            response.end();
          }
        })();
      });
    },
  };
}
