import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Арендатор. Ключ workspace_id стоит в каждой таблице ядра (Р-7). */
export const workspace = pgTable("workspace", {
  // uuidv7 встроен в Postgres 18: монотонный, не рвёт индекс на вставке.
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  /**
   * Счётчик порядка для клиентов. Номер берётся ТОЛЬКО так:
   *   UPDATE workspace SET last_seq = last_seq + 1 ... RETURNING last_seq
   * внутри той же транзакции, что и сама запись.
   *
   * Зачем не bigserial: последовательность выдаёт номер при ВСТАВКЕ, а видимой
   * строка становится при ФИКСАЦИИ — это разный порядок. Клиент с курсором
   * по такому номеру навсегда пропускает строку, зафиксированную позже соседа
   * (разбор: dock/decisions.md#foundation, пункт 1).
   *
   * Блокировка строки пространства выстраивает записи в очередь, поэтому номер
   * выдаётся в порядке фиксации и без дыр: откат возвращает номер обратно.
   * Платим сериализацией записи в пределах одного пространства — при наших
   * объёмах незаметно. Порог пересмотра: сотни записей в секунду в одном
   * пространстве.
   */
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
