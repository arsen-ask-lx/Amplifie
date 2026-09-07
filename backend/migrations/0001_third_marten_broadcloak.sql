CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_member" (
	"conversation_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_member_conversation_id_participant_id_pk" PRIMARY KEY("conversation_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_participant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"trust" text DEFAULT 'trusted' NOT NULL,
	"client_msg_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "message_conversation_client_msg_uq" UNIQUE("conversation_id","client_msg_id"),
	CONSTRAINT "message_workspace_seq_uq" UNIQUE("workspace_id","seq")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "last_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_parent_id_conversation_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_participant_id_participant_id_fk" FOREIGN KEY ("author_participant_id") REFERENCES "public"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_workspace_parent_idx" ON "conversation" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "conversation_member_workspace_participant_idx" ON "conversation_member" USING btree ("workspace_id","participant_id");--> statement-breakpoint
CREATE INDEX "message_conversation_seq_idx" ON "message" USING btree ("conversation_id","seq");--> statement-breakpoint

-- ============================================================================
-- Дописано руками. Инварианты запрещает БАЗА, а не соглашение в коде.
-- ============================================================================

-- Закрытые перечни.
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_kind_ck"
  CHECK (kind IN ('channel', 'thread', 'meeting', 'doc_thread', 'dm'));
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_kind_ck"
  CHECK (kind IN ('human', 'agent', 'summary', 'transcript', 'system'));
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_trust_ck"
  CHECK (trust IN ('trusted', 'untrusted', 'external'));
--> statement-breakpoint

-- Ветка обязана иметь родителя, корень обязан его не иметь.
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_parent_matches_kind_ck"
  CHECK ((kind = 'thread' AND parent_id IS NOT NULL)
      OR (kind <> 'thread' AND parent_id IS NULL));
--> statement-breakpoint

-- ГЛАВНЫЙ инвариант этого среза: у ветки НЕТ своих участников.
-- Право читается у корня дерева разговоров (dock/06-разбор-мессенджеров.md).
-- Без этой проверки правило продержится ровно до первого «а давай тут по-быстрому».
CREATE OR REPLACE FUNCTION conversation_member_only_on_root() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM conversation c
             WHERE c.id = NEW.conversation_id AND c.parent_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'у ветки нет своих участников: членство заводится только на корне разговора';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER conversation_member_root_only
  BEFORE INSERT OR UPDATE ON "conversation_member"
  FOR EACH ROW EXECUTE FUNCTION conversation_member_only_on_root();
--> statement-breakpoint

-- Номер выдаётся только счётчиком пространства и только вперёд.
ALTER TABLE "message" ADD CONSTRAINT "message_seq_positive_ck" CHECK (seq > 0);
--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_last_seq_ck" CHECK (last_seq >= 0);
--> statement-breakpoint

-- Лента канала читается «последние N по убыванию номера» — самый частый запрос.
CREATE INDEX "message_conversation_seq_desc_idx"
  ON "message" USING btree ("conversation_id", "seq" DESC);
--> statement-breakpoint

-- Догон по номеру в пределах пространства: /v1/sync?after=N
CREATE INDEX "message_workspace_seq_idx" ON "message" USING btree ("workspace_id", "seq");
