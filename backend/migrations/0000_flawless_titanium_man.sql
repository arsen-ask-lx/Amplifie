CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_workspace_account_uq" UNIQUE("workspace_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"actor_participant_id" uuid,
	"originator_account_id" uuid,
	"accountable_account_id" uuid,
	"attribution" text DEFAULT 'direct_human' NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_workspace_kind_idx" ON "participant" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "session_account_idx" ON "session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "event_workspace_seq_idx" ON "event" USING btree ("workspace_id","seq");--> statement-breakpoint

-- ============================================================================
-- Ниже — дописано руками. Генератор про это не знает.
-- Правило: невозможное сочетание запрещает БАЗА, а не договорённость в коде.
-- ============================================================================

-- Почта хранится нормализованной. Нормализация делается на границе, но база
-- обязана это подтверждать: иначе однажды заедет "Ivan@..." и заведёт двойника.
ALTER TABLE "account" ADD CONSTRAINT "account_email_normalized_ck"
  CHECK (email = lower(btrim(email)) AND position('@' in email) > 1);
--> statement-breakpoint

-- Вид участника и роль — закрытые перечни.
ALTER TABLE "participant" ADD CONSTRAINT "participant_kind_ck"
  CHECK (kind IN ('human', 'agent'));
--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_role_ck"
  CHECK (role IN ('owner', 'admin', 'member', 'guest'));
--> statement-breakpoint

-- Человек входит по паролю и обязан иметь аккаунт; агент не входит и не имеет.
-- Без этого возможен «человек без входа» — тихий сирота, который потом всплывёт.
ALTER TABLE "participant" ADD CONSTRAINT "participant_account_matches_kind_ck"
  CHECK ((kind = 'human' AND account_id IS NOT NULL)
      OR (kind = 'agent' AND account_id IS NULL));
--> statement-breakpoint

-- Источник ответственности. 'unattributed' допустим, но обязан быть виден
-- в отчётах отдельно: выродившаяся привязка помечается, а не прячется (Р-3).
ALTER TABLE "event" ADD CONSTRAINT "event_attribution_ck"
  CHECK (attribution IN ('direct_human', 'delegation', 'owner_fallback', 'unattributed'));
--> statement-breakpoint

-- Журнал только дописывается. Правка и удаление запрещены на уровне базы,
-- потому что «мы же не будем» — это не гарантия (Р-2).
CREATE OR REPLACE FUNCTION event_is_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event — журнал только для вставки: % запрещён', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_no_update_delete
  BEFORE UPDATE OR DELETE ON "event"
  FOR EACH ROW EXECUTE FUNCTION event_is_append_only();
--> statement-breakpoint

-- Подметание протухших сессий будет ходить по сроку.
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");
