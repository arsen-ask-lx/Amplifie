import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Каждый модуль владеет своими таблицами и держит схему у себя.
  schema: "./src/kernel/**/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? "postgres://amplifie:amplifie_dev_only@127.0.0.1:5432/amplifie",
  },
  // Генератор — ускоритель, а не власть: сгенерированный SQL читается
  // и правится руками (политики, частичные индексы, CHECK).
  verbose: true,
  strict: true,
});
