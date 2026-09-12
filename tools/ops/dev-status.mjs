import { readFile } from "node:fs/promises";

const RUNTIME = {
  "vite-dev": "Vite",
  "caddy-static": "Caddy",
};

export function classifyRuntime(marker) {
  return RUNTIME[marker ?? ""] ?? "unknown";
}

async function get(url) {
  const signal = AbortSignal.timeout(3_000);
  return fetch(url, { signal });
}

async function configuredOrigin() {
  if (process.env.HTTP_PORT) {
    return `http://localhost:${process.env.HTTP_PORT}`;
  }

  const environment = await readFile(new URL("../../.env", import.meta.url), "utf8").catch(
    () => "",
  );
  const port = environment.match(/^HTTP_PORT=(\d+)$/m)?.[1] ?? "8477";
  return `http://localhost:${port}`;
}

async function main() {
  const origin = process.argv[2] ?? (await configuredOrigin());

  try {
    const page = await get(origin);
    const runtime = classifyRuntime(page.headers.get("x-amplifie-frontend"));
    const health = await get(new URL("/health", origin));

    if (runtime === "unknown") {
      console.error(`неизвестный сервер на ${origin}: нет маркера runtime`);
      process.exitCode = 1;
      return;
    }

    if (!health.ok) {
      console.error(`${runtime} отвечает на ${origin}, но API недоступен (${health.status})`);
      process.exitCode = 1;
      return;
    }

    console.log(`${runtime} отвечает на ${origin}; API здоров`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`не удалось подключиться к ${origin}: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
