import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

/**
 * Настройки моста — на машине человека, а не у нас.
 *
 * Здесь важна одна вещь: **что запускать, решает эта машина.** Сервер
 * присылает только текст вопроса. Если бы команду запуска диктовал сервер,
 * мост превратился бы в дыру размером с удалённое выполнение кода
 * на всех подключённых ноутбуках сразу.
 */

export interface Saved {
  /** Адрес пространства, к которому подключён мост. */
  url: string;
  /** Постоянный токен моста. Лежит только здесь. */
  token: string;
  name: string;
}

/** Где храним токен: домашняя папка, а не рядом с кодом. */
export function statePath(): string {
  return join(homedir(), ".amplifie", "bridge.json");
}

export function load(): Saved | null {
  try {
    const raw = readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed.url || !parsed.token || !parsed.name) return null;
    return { url: parsed.url, token: parsed.token, name: parsed.name };
  } catch (error) {
    // «Файла нет» — обычное состояние первого запуска, а не отказ.
    // Всё остальное — испорченный файл, и об этом надо сказать вслух:
    // молча выдать «не подключён» значит отправить человека за новым
    // кодом вместо того, чтобы починить одну строку.
    const why = error as NodeJS.ErrnoException;
    if (why.code !== "ENOENT") {
      console.error(`не удалось прочитать ${statePath()}: ${why.message}`);
    }
    return null;
  }
}

export function save(state: Saved): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  try {
    // Только владельцу. На Windows это ничего не меняет — там права
    // наследуются от папки профиля, — но на всех остальных меняет.
    chmodSync(path, 0o600);
  } catch (error) {
    console.error(`не удалось ограничить права на ${path}: ${String(error)}`);
  }
}

export interface Options {
  url: string;
  code: string | undefined;
  name: string;
  /** Какой клиент запускать: имя из списка известных. */
  client: string;
  /** Чем его запускать, если он не в PATH. */
  command: string | undefined;
  timeoutMs: number;
}

function argument(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
}

export function readOptions(argv: string[] = process.argv.slice(2)): Options {
  const timeout = Number(process.env.AMPLIFIE_MODEL_TIMEOUT_MS);
  return {
    url: argument(argv, "--url") ?? process.env.AMPLIFIE_URL ?? "http://localhost:8477",
    code: argument(argv, "--code") ?? process.env.AMPLIFIE_BRIDGE_CODE,
    name: argument(argv, "--name") ?? process.env.AMPLIFIE_BRIDGE_NAME ?? hostname(),
    client: argument(argv, "--client") ?? process.env.AMPLIFIE_MODEL ?? "claude-cli",
    command: process.env.AMPLIFIE_MODEL_COMMAND,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
  };
}
