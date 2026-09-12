ALTER TABLE "conversation" ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
-- Закрытый список значений: «видимость» с опечаткой молча закрыла бы канал
-- от всех либо открыла бы всем. Ни то, ни другое не должно быть возможно.
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_visibility_ck"
  CHECK ("visibility" IN ('workspace', 'private'));--> statement-breakpoint

-- У ветки видимость не читается — она наследует корень. Чтобы никто
-- не решил, что её можно задать отдельно, у веток она обязана быть
-- значением по умолчанию.
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_thread_visibility_ck"
  CHECK ("parent_id" IS NULL OR "visibility" = 'workspace');
