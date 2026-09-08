import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspace } from "../space/schema.js";

/**
 * Аккаунт — ГЛОБАЛЬНЫЙ вход, не привязан к пространству.
 *
 * Почему не «пользователь внутри пространства»: подрядчик, работающий с двумя
 * компаниями, — это один вход и ДВА лица. Если привязать вход к пространству,
 * гости (функция 88) становятся невозможны, а чинится это только миграцией
 * всех данных. Разбор — dock/04-каркас.md, слой I.
 */
export const account = pgTable("account", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  // Хранится уже приведённой к нижнему регистру — нормализация на границе,
  // а не citext: расширение ради одного поля не берём.
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Участник — лицо в ОДНОМ пространстве. Человек ИЛИ агент, одна сущность (Р-1).
 *
 * Поля для отрисовки (display_name, kind) лежат здесь, а не в спутнике:
 * лента сообщений рисуется без единого соединения. Редкое (бюджет агента,
 * среда запуска) уедет в participant_agent, когда появится агент.
 */
export const participant = pgTable(
  "participant",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // У агента аккаунта нет — он не входит по паролю.
    accountId: uuid("account_id").references(() => account.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один вход = одно лицо в пространстве.
    unique("participant_workspace_account_uq").on(t.workspaceId, t.accountId),
    // Ключ арендатора ПЕРВЫМ полем — иначе индекс не сработает под RLS (Р-7).
    index("participant_workspace_kind_idx").on(t.workspaceId, t.kind),
    // Цель составного внешнего ключа: «ответственный — только человек»
    // (task-010). Без уникальности на пару Postgres не разрешит ссылаться
    // на (id, kind), и правило пришлось бы держать кодом.
    unique("participant_id_kind_uq").on(t.id, t.kind),
  ],
);

/**
 * Сессия. В базе лежит ХЕШ токена, а не токен: утечка дампа не даёт войти.
 * Отзыв — обычный DELETE, поэтому никаких JWT с их вечной проблемой отзыва.
 */
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [index("session_account_idx").on(t.accountId)],
);

/**
 * Приглашение в пространство (Р-009).
 *
 * ТОКЕН ЗДЕСЬ НЕ ХРАНИТСЯ. Лежит только его SHA-256: токен — это пароль,
 * и утечка дампа не должна давать входа. Сырое значение показывается
 * ровно один раз, в ответе на выпуск.
 *
 * Одноразовость держится не проверкой в коде, а условием в самом UPDATE
 * (см. repo.redeemInvite): два устройства одновременно — входит один.
 */

/**
 * Мост — машина участника, на которой живёт его подписка (task-001).
 *
 * Лежит рядом с сессией не случайно: это такое же удостоверение, только
 * не браузера, а машины. Поэтому и устройство то же — хеш токена, срок,
 * последний контакт. Разные они в одном: сессия действует от лица
 * учётной записи, мост — от лица участника в одном пространстве.
 *
 * ⚠️ Токена подписки здесь нет и быть не может. Мы его не видим: клиент
 * читает свои учётные данные сам, на своей машине (Р-012).
 *
 * Одна таблица, а не «код» плюс «мост»: строка рождается кодом
 * подключения и превращается в мост, когда код погашен. Так одноразовость
 * держит один условный UPDATE, а не сговор двух таблиц.
 */
export const bridge = pgTable(
  "bridge",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Чья подписка. Мост всегда принадлежит человеку, а не пространству. */
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    /** Код подключения: в базе только хеш, как у приглашения (Р-009). */
    codeHash: text("code_hash").notNull().unique(),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }).notNull(),
    /** Постоянный токен моста. Пусто, пока код не погашен. */
    tokenHash: text("token_hash").unique(),
    /** Имя машины — чтобы человек отличал ноутбук от рабочего компьютера. */
    name: text("name"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    /** Когда мост в последний раз приходил за работой. По нему «на связи». */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bridge_workspace_participant_idx").on(table.workspaceId, table.participantId)],
);

/**
 * Ключ поставщика модели: личный участника либо общий для пространства.
 *
 * ОДНА ТАБЛИЦА НА ОБА СЛУЧАЯ. `participant_id` назван — ключ личный;
 * пуст — владелец само пространство. Это не полиморфизм: владелец
 * либо участник, либо арендатор, третьего нет. Уникальность держат два
 * ЧАСТИЧНЫХ индекса — по одному на случай (см. миграцию).
 *
 * ⚠️ САМОГО КЛЮЧА ЗДЕСЬ НЕТ. Лежит шифротекст (Р-016): AES-256-GCM,
 * мастер-ключ в окружении, версия и привязка к строке. Наружу отдаётся
 * только `hint` — последние четыре знака, чтобы человек узнал свой ключ
 * и не смог им воспользоваться.
 */
export const modelKey = pgTable(
  "model_key",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Пусто — ключ пространства. Каскад: ушёл участник — ушёл его ключ.
    participantId: uuid("participant_id").references(() => participant.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    version: integer("version").notNull(),
    iv: text("iv").notNull(),
    ciphertext: text("ciphertext").notNull(),
    tag: text("tag").notNull(),
    /** Последние знаки ключа. Ровно столько, чтобы узнать, и не больше. */
    hint: text("hint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("model_key_workspace_idx").on(t.workspaceId, t.participantId)],
);
