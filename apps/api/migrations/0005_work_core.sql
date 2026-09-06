CREATE TABLE "agreement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"source_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_conversation_fingerprint_uq" UNIQUE("conversation_id","source_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "citation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_agreement_uq" UNIQUE("agreement_id")
);
--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_proposed_by_participant_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_confirmed_by_participant_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assigned_to_participant_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_workspace_idx" ON "agreement" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "citation_agreement_idx" ON "citation" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "citation_message_idx" ON "citation" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "task_workspace_idx" ON "task" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- ── Инварианты ядра работ, дописанные руками ──────────────────────────

-- Статусы из закрытого списка: опечатка иначе тихо выводит договорённость
-- из-под всех выборок разом.
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_status_ck"
  CHECK ("status" IN ('proposed', 'confirmed', 'rejected', 'superseded'));--> statement-breakpoint

-- «Подтверждено» — это ДВА поля разом. Урок 2026-09-06: ставить их
-- надо одним запросом, отложить проверку Postgres не умеет.
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_confirmed_pair_ck"
  CHECK (("confirmed_at" IS NULL) = ("confirmed_by" IS NULL));--> statement-breakpoint

-- Подтверждающий обязан быть у подтверждённой и обязан отсутствовать
-- у остальных: «отклонена, но кем-то подтверждена» — не состояние.
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_confirmed_only_when_confirmed_ck"
  CHECK (("status" = 'confirmed') = ("confirmed_by" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "agreement" ADD CONSTRAINT "agreement_text_not_blank_ck"
  CHECK (length(btrim("text")) > 0);--> statement-breakpoint

ALTER TABLE "task" ADD CONSTRAINT "task_status_ck"
  CHECK ("status" IN ('open', 'doing', 'done', 'dropped'));--> statement-breakpoint

ALTER TABLE "task" ADD CONSTRAINT "task_title_not_blank_ck"
  CHECK (length(btrim("title")) > 0);--> statement-breakpoint

-- Пустая цитата — это отсутствие цитаты, выданное за её наличие.
-- Ровно то, против чего вся эта таблица и заведена.
ALTER TABLE "citation" ADD CONSTRAINT "citation_quote_not_blank_ck"
  CHECK (length(btrim("quote")) > 0);
