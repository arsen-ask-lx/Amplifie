CREATE TABLE "model_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"participant_id" uuid,
	"provider" text NOT NULL,
	"version" integer NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL,
	"tag" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "model_key" ADD CONSTRAINT "model_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_key" ADD CONSTRAINT "model_key_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_key_workspace_idx" ON "model_key" USING btree ("workspace_id","participant_id");--> statement-breakpoint
-- Дальше — руками: генератор не умеет частичных индексов, а без них
-- уникальность «один живой ключ на поставщика» не выразить.

-- Один ЖИВОЙ личный ключ на участника и поставщика.
-- Отозванные не считаются: иначе нельзя было бы завести ключ заново.
CREATE UNIQUE INDEX "model_key_one_per_participant"
  ON "model_key" ("workspace_id", "participant_id", "provider")
  WHERE "revoked_at" IS NULL AND "participant_id" IS NOT NULL;--> statement-breakpoint

-- Один ЖИВОЙ ключ пространства на поставщика.
-- Отдельным индексом, потому что NULL в уникальном индексе не сравнивается
-- сам с собой: без этого можно было бы завести десять общих ключей.
CREATE UNIQUE INDEX "model_key_one_per_workspace"
  ON "model_key" ("workspace_id", "provider")
  WHERE "revoked_at" IS NULL AND "participant_id" IS NULL;--> statement-breakpoint

-- Подсказка — последние знаки ключа, не сам ключ. Четыре знака узнаваемы
-- и бесполезны для вызова; предел стережёт от «а давайте покажем побольше».
ALTER TABLE "model_key" ADD CONSTRAINT "model_key_hint_short"
  CHECK (length("hint") BETWEEN 1 AND 4);
