CREATE TABLE "bridge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"token_hash" text,
	"name" text,
	"joined_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "bridge_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "bridge" ADD CONSTRAINT "bridge_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge" ADD CONSTRAINT "bridge_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bridge_workspace_participant_idx" ON "bridge" USING btree ("workspace_id","participant_id");--> statement-breakpoint
-- Дописано руками. Три состояния строки, и промежуточных быть не должно:
-- «код выдан» (ничего не заполнено), «мост подключён» (заполнено всё),
-- «отозван». «Подключён, но неизвестно кем и без токена» — не состояние,
-- а следствие незаконченной записи.
--
-- Проверка НЕ откладываемая: Postgres умеет откладывать только UNIQUE и FK,
-- но не CHECK. На этом мы уже обожглись на приглашениях — там пришлось
-- ставить оба поля одним UPDATE. Здесь то же: три поля ставятся вместе.
ALTER TABLE "bridge" ADD CONSTRAINT "bridge_joined_together" CHECK (
  ("joined_at" IS NULL) = ("token_hash" IS NULL)
  AND ("joined_at" IS NULL) = ("name" IS NULL)
);--> statement-breakpoint
-- Имя машины из пробелов не помогает отличить ноутбук от рабочего компьютера,
-- а именно за этим оно и заведено.
ALTER TABLE "bridge" ADD CONSTRAINT "bridge_name_not_blank" CHECK (
  "name" IS NULL OR length(btrim("name")) > 0
);
