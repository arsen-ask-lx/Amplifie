CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_participant_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_redeemed_by_participant_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_workspace_idx" ON "invite" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- ── Инварианты, дописанные руками (Р-009) ─────────────────────────────
-- Генератор их не знает: он видит типы, а не смысл.

-- «Погашено» — это ДВА поля разом. Одно без другого означает запись,
-- о которой нельзя сказать, использовано приглашение или нет.
ALTER TABLE "invite" ADD CONSTRAINT "invite_redeemed_pair_ck"
  CHECK (("redeemed_at" IS NULL) = ("redeemed_by" IS NULL));--> statement-breakpoint

-- В базе лежит SHA-256 в шестнадцатеричном виде — ровно 64 знака.
-- Если сюда однажды попробуют записать сам токен, база не даст.
ALTER TABLE "invite" ADD CONSTRAINT "invite_token_hash_shape_ck"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- Роль приглашённого — из закрытого списка. Владельца приглашением
-- не выдают: владелец один и появляется вместе с пространством.
ALTER TABLE "invite" ADD CONSTRAINT "invite_role_ck"
  CHECK ("role" IN ('member', 'guest'));--> statement-breakpoint

-- Срок обязан быть позже создания: приглашение, умершее раньше рождения,
-- не значит ничего. Просрочка в тестах проверяется настоящим коротким
-- сроком и настоящим ожиданием, а не выдуманным прошлым.
ALTER TABLE "invite" ADD CONSTRAINT "invite_expiry_after_creation_ck"
  CHECK ("expires_at" > "created_at");
