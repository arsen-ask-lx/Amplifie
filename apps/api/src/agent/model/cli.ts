import { spawn } from "node:child_process";
import {
  type Answer,
  type Ask,
  BadAnswerError,
  type Provider,
  ProviderUnavailableError,
} from "./provider.js";

/**
 * Подписка: спрашиваем через ОФИЦИАЛЬНЫЙ клиент владельца (Р-012).
 *
 * Токена подписки мы не видим и не пересылаем. Он лежит там, куда его
 * положил чужой клиент, и читается только им. Запрос к модели делает
 * этот клиент — то есть поверхность, которая из запрета исключена.
 *
 * ⚠️ ЭТО ЗАПУСК ПОСТОРОННЕГО КОДА. Поэтому:
 *   • команда берётся ТОЛЬКО из настроек сервера — никогда из запроса,
 *     никогда из сообщения, никогда из базы;
 *   • оболочки нет: аргументы идут списком, подстановки не происходит,
 *     и «; rm -rf» внутри сообщения остаётся текстом;
 *   • подсказка передаётся через СТАНДАРТНЫЙ ВВОД, а не аргументом:
 *     аргументы видны в списке процессов всей машине.
 *
 * `spawn`, а не `execFile`: у асинхронного `execFile` нет передачи ввода
 * вовсе — подсказка просто не дошла бы до клиента. Первая редакция этого
 * файла была написана именно так и не работала бы ни разу.
 */

export interface CliShape {
  name: string;
  /** Исполняемый файл: `claude`, `codex`. Из настроек, не из данных. */
  command: string;
  /** Постоянные аргументы, тоже из настроек. */
  args: string[];
  /** Сколько ждём ответа. Вышел срок — ошибка, а не молчание. */
  timeoutMs: number;
}

/** Ответ длиннее этого не читаем: чужой клиент не должен съесть память. */
const MAX_OUTPUT = 1_000_000;

interface Finished {
  code: number | null;
  stdout: string;
  stderr: string;
}

function collect(shape: CliShape, text: string): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(shape.command, shape.args, {
      // Оболочки нет. Это не про скорость, а единственное, что отделяет
      // аргумент от команды.
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (act: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      act();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(new ProviderUnavailableError(`${shape.name}: ответа нет ${shape.timeoutMs} мс`)),
      );
    }, shape.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() =>
        reject(
          new ProviderUnavailableError(
            `${shape.name}: не удалось запустить «${shape.command}» — ${error.message}`,
          ),
        ),
      );
    });
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));

    // Труба может закрыться раньше, если клиент упал: без обработчика
    // это станет необработанным отказом и уронит процесс целиком.
    // Но и глушить нельзя — это сведение о том, ПОЧЕМУ ответа не будет.
    child.stdin.on("error", (error) => {
      stderr += `\n[не удалось передать подсказку] ${error.message}`;
    });
    child.stdin.end(text, "utf8");
  });
}

export function cliProvider(shape: CliShape): Provider {
  return {
    name: shape.name,
    billing: "subscription",

    async ask(input: Ask): Promise<Answer> {
      // Системная часть и разговор идут одним текстом: у клиентов
      // командной строки нет отдельного поля для системной подсказки,
      // и притворяться, что есть, — врать самим себе.
      const asked = `${input.system}\n\n---\n\n${input.prompt}`;
      const out = await collect(shape, asked);

      const answer = out.stdout.trim();
      const tail = out.stderr.trim().slice(0, 200);

      if (out.code !== 0) {
        throw new ProviderUnavailableError(
          `${shape.name}: клиент вышел с кодом ${out.code}${tail ? ` — ${tail}` : ""}`,
        );
      }
      if (!answer) {
        throw new BadAnswerError(
          `${shape.name}: пустой ответ${tail ? `; в поток ошибок: ${tail}` : ""}`,
        );
      }
      // Расход по подписке клиент не сообщает — и мы его не выдумываем.
      return { text: answer };
    },
  };
}
