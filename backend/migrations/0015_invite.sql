-- Приглашения (Р-009, task-017). Таблица заводится заново: прежняя была
-- снесена вместе с договорённостями миграцией 0010, и возвращать её
-- «как было» нельзя — одноразовость сменилась пределом числа входов.
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_participant_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_workspace_idx" ON "invite" USING btree ("workspace_id","created_at");--> statement-breakpoint

-- ── Инварианты, дописанные руками (Р-009) ─────────────────────────────
-- Генератор их не знает: он видит типы, а не смысл.

-- В базе лежит SHA-256 в шестнадцатеричном виде — ровно 64 знака.
-- Если сюда однажды попробуют записать сам токен, база не даст.
ALTER TABLE "invite" ADD CONSTRAINT "invite_token_hash_shape_ck"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- Роль приглашённого — из закрытого списка. Владельца приглашением
-- не выдают: владелец один и появляется вместе с пространством.
ALTER TABLE "invite" ADD CONSTRAINT "invite_role_ck"
  CHECK ("role" IN ('member', 'guest'));--> statement-breakpoint

-- Срок обязан быть позже создания: приглашение, умершее раньше рождения,
-- не значит ничего.
ALTER TABLE "invite" ADD CONSTRAINT "invite_expiry_after_creation_ck"
  CHECK ("expires_at" > "created_at");--> statement-breakpoint

-- ⚠️ ПРЕДЕЛА «БЕЗ ОГРАНИЧЕНИЯ» НЕТ НАМЕРЕННО. Утёкшая бессрочная ссылка —
-- это неограниченный ущерб; утёкшая с пределом — ограниченный. Верхняя
-- граница в 500 взята с запасом к нашей цели в тысячу сотрудников:
-- позвать всех одной ссылкой всё равно нельзя, и это правильно.
ALTER TABLE "invite" ADD CONSTRAINT "invite_max_uses_ck"
  CHECK ("max_uses" BETWEEN 1 AND 500);--> statement-breakpoint

-- ⚠️ СЧЁТЧИК НЕ ПЕРЕПРЫГИВАЕТ ПРЕДЕЛ. Одноразовость (а с ней и любая
-- «разовость» на N входов) держится условием в самом UPDATE, но условие
-- живёт в коде, а этот CHECK — в базе. Если условие однажды сломают,
-- база не даст записать 51-й вход в ссылку на пятьдесят.
ALTER TABLE "invite" ADD CONSTRAINT "invite_used_within_max_ck"
  CHECK ("used" >= 0 AND "used" <= "max_uses");
