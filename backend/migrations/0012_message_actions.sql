-- task-014: действия над репликой — ответить, переслать, закрепить, удалить.
--
-- ⚠️ ССЫЛКИ С `ON DELETE SET NULL`. Каскад унёс бы вместе с удалённой
-- репликой все ответы на неё — то есть чужие слова. Запрет сделал бы
-- удаление невозможным, стоило кому-то один раз процитировать.
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "reply_to_id" uuid;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "forwarded_from_id" uuid;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_reply_to_id_message_id_fk";
ALTER TABLE "message" ADD CONSTRAINT "message_reply_to_id_message_id_fk"
  FOREIGN KEY ("reply_to_id") REFERENCES "message"("id") ON DELETE SET NULL;

ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_forwarded_from_id_message_id_fk";
ALTER TABLE "message" ADD CONSTRAINT "message_forwarded_from_id_message_id_fk"
  FOREIGN KEY ("forwarded_from_id") REFERENCES "message"("id") ON DELETE SET NULL;

-- Частичный индекс: закреплённых в разговоре единицы, а ищутся они
-- на каждом открытии. Полный индекс по столбцу, который почти везде пуст,
-- был бы платой без выгоды.
CREATE INDEX IF NOT EXISTS "message_conversation_pinned_idx"
  ON "message" ("conversation_id", "pinned_at") WHERE "pinned_at" IS NOT NULL;
