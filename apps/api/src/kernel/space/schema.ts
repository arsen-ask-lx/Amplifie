import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Арендатор. Ключ workspace_id стоит в каждой таблице ядра (Р-7). */
export const workspace = pgTable("workspace", {
  // uuidv7 встроен в Postgres 18: монотонный, не рвёт индекс на вставке.
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
