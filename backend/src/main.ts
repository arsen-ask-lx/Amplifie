import { config } from "./platform/config.js";
import { pool } from "./platform/db.js";
import { buildApp } from "./surface/http/app.js";

const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "останавливаюсь");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.fatal({ err: error }, "не удалось запуститься");
  process.exit(1);
}
